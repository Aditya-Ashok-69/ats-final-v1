import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { notifyJobStakeholders, notifyUser, buildCandidateEmail } from '../lib/notify.js';

const router = Router();
router.use(requireAuth);

router.get('/:id', async (req, res) => {
  const interview = await prisma.interview.findUnique({
    where: { id: req.params.id },
    include: {
      interviewer: { select: { id: true, name: true } },
      scorecard: true,
      application: { include: { candidate: true, job: true } },
    },
  });
  if (!interview) return res.status(404).json({ error: 'Interview not found.' });
  res.json(interview);
});

router.patch('/:id', async (req, res) => {
  const parsed = z.object({ status: z.enum(['SCHEDULED', 'COMPLETED', 'CANCELLED']) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid status.' });
  try {
    const interview = await prisma.interview.update({ where: { id: req.params.id }, data: parsed.data });
    res.json(interview);
  } catch {
    res.status(404).json({ error: 'Interview not found.' });
  }
});

// Submit feedback. Completing the round triggers:
//   1. Shortlist check (existing)
//   2. Auto-advance to next round if avg >= autoAdvanceThreshold AND round < maxInterviewRounds
//   3. Hard stop if round === maxInterviewRounds regardless of score
const scorecardSchema = z.object({
  overallScore: z.number().int().min(0).max(100),
  recommendation: z.enum(['STRONG_YES', 'YES', 'NO', 'STRONG_NO']),
  criteria: z.array(z.object({ name: z.string(), score: z.number() })).optional(),
  comments: z.string().optional(),
});

router.post('/:id/scorecard', async (req, res) => {
  const parsed = scorecardSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Give an overall score (0-100) and a recommendation.' });

  const interview = await prisma.interview.findUnique({
    where: { id: req.params.id },
    include: { application: { include: { job: true, candidate: true } } },
  });
  if (!interview) return res.status(404).json({ error: 'Interview not found.' });

  const existing = await prisma.scorecard.findUnique({ where: { interviewId: interview.id } });
  if (existing) return res.status(409).json({ error: 'Feedback for this interview already exists.' });

  await prisma.scorecard.create({
    data: {
      interviewId: interview.id,
      applicationId: interview.applicationId,
      authorId: req.user.id,
      overallScore: parsed.data.overallScore,
      recommendation: parsed.data.recommendation,
      criteria: parsed.data.criteria ? JSON.stringify(parsed.data.criteria) : null,
      comments: parsed.data.comments,
    },
  });

  await prisma.interview.update({ where: { id: interview.id }, data: { status: 'COMPLETED' } });
  await prisma.activityLog.create({
    data: { applicationId: interview.applicationId, actorId: req.user.id, action: 'FEEDBACK_SUBMITTED' },
  });

  const round = interview.round;
  const job = interview.application.job;
  const candidate = interview.application.candidate;
  const appId = interview.applicationId;

  // Aggregate all scorecards for this round
  const roundScorecards = await prisma.scorecard.findMany({
    where: { applicationId: appId, interview: { round } },
  });
  const avg = Math.round(
    roundScorecards.reduce((s, c) => s + c.overallScore, 0) / roundScorecards.length
  );

  // Any interviews for this round still waiting for feedback?
  const pending = await prisma.interview.count({
    where: { applicationId: appId, round, status: { not: 'COMPLETED' } },
  });

  const maxRounds = job.maxInterviewRounds || 0;        // 0 = unlimited
  const autoThreshold = job.autoAdvanceThreshold ?? 75;
  const shortlistThreshold = job.shortlistThreshold;

  let decision = null;
  let autoAdvanced = false;
  let roundLimitReached = false;

  if (pending === 0) {
    // All feedback for this round is in — evaluate
    const meetsShortlist = avg >= shortlistThreshold;
    const meetsAutoAdvance = avg >= autoThreshold;
    const atMaxRound = maxRounds > 0 && round >= maxRounds;

    decision = {
      round,
      average: avg,
      shortlistThreshold,
      autoAdvanceThreshold: autoThreshold,
      maxInterviewRounds: maxRounds,
      shortlisted: meetsShortlist,
      atMaxRound,
    };

    if (atMaxRound) {
      // Hard stop — this was the final allowed round
      roundLimitReached = true;
      await prisma.activityLog.create({
        data: {
          applicationId: appId,
          actorId: req.user.id,
          action: 'MAX_ROUNDS_REACHED',
          fromStage: 'INTERVIEW',
        },
      });
      await notifyJobStakeholders({
        job,
        ownerId: interview.application.ownerId,
        type: 'SHORTLISTED',
        message: `${candidate.name} completed the final round (${round}/${maxRounds}) for ${job.title} with avg score ${avg}. ${meetsShortlist ? 'Meets shortlist threshold — ready for offer decision.' : 'Below shortlist threshold — manual review needed.'}`,
        link: `/jobs/${job.id}`,
      });
    } else if (meetsAutoAdvance) {
      // Auto-advance: schedule next round prompt
      autoAdvanced = true;
      await prisma.activityLog.create({
        data: {
          applicationId: appId,
          actorId: req.user.id,
          action: 'AUTO_ADVANCED_TO_NEXT_ROUND',
          fromStage: 'INTERVIEW',
          toStage: 'INTERVIEW',
        },
      });
      await notifyJobStakeholders({
        job,
        ownerId: interview.application.ownerId,
        type: 'SHORTLISTED',
        message: `${candidate.name} scored ${avg}/${autoThreshold} in round ${round} for ${job.title} — auto-advancing to round ${round + 1}. Schedule the next interview.`,
        link: `/jobs/${job.id}`,
      });
      decision.nextRound = round + 1;
    } else {
      // Below auto-advance threshold — needs human decision
      await prisma.activityLog.create({
        data: {
          applicationId: appId,
          actorId: req.user.id,
          action: meetsShortlist ? 'SHORTLISTED' : 'BELOW_SHORTLIST_THRESHOLD',
        },
      });
      await notifyJobStakeholders({
        job,
        ownerId: interview.application.ownerId,
        type: 'SHORTLISTED',
        message: meetsShortlist
          ? `${candidate.name} cleared round ${round} for ${job.title} (avg ${avg}) — ready to shortlist.`
          : `${candidate.name} scored ${avg}/${shortlistThreshold} in round ${round} for ${job.title} — below threshold, needs a decision.`,
        link: `/jobs/${job.id}`,
      });
    }
  }

  res.status(201).json({ roundAverage: avg, pendingFeedback: pending, decision, autoAdvanced, roundLimitReached });
});

// ─── Offer letter generation ───────────────────────────────────────────────────
// GET /api/interviews/offer/:applicationId
// Generates a ready-to-edit offer letter draft based on the candidate, job,
// and their interview performance. No external API — fully template-driven.
router.get('/offer/:applicationId', requireRole('ADMIN', 'RECRUITER', 'HIRING_MANAGER'), async (req, res) => {
  const app = await prisma.application.findUnique({
    where: { id: req.params.applicationId },
    include: {
      candidate: true,
      job: { include: { hiringManager: { select: { name: true } } } },
      scorecards: { orderBy: { createdAt: 'desc' } },
      interviews: { orderBy: { round: 'asc' }, include: { scorecard: true } },
    },
  });
  if (!app) return res.status(404).json({ error: 'Application not found.' });

  // Summarise interview performance
  const completedRounds = [...new Set(
    app.interviews.filter((iv) => iv.status === 'COMPLETED').map((iv) => iv.round)
  )].sort((a, b) => a - b);

  const avgScore = app.scorecards.length
    ? Math.round(app.scorecards.reduce((s, c) => s + c.overallScore, 0) / app.scorecards.length)
    : null;

  const strongYes = app.scorecards.filter((c) => c.recommendation === 'STRONG_YES').length;
  const yes = app.scorecards.filter((c) => c.recommendation === 'YES').length;

  const today = new Date();
  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() + 30); // default: 30 days from now

  const fmt = (d) => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const hiringManagerName = app.job.hiringManager?.name || 'Hiring Manager';

  const performanceLine = avgScore != null
    ? `Throughout ${completedRounds.length} interview round${completedRounds.length !== 1 ? 's' : ''}, you demonstrated exceptional skills with an average interview score of ${avgScore}/100${strongYes + yes > 0 ? `, with ${strongYes + yes} positive recommendation${strongYes + yes !== 1 ? 's' : ''} from our interview panel` : ''}.`
    : `You have impressed our team throughout the interview process.`;

  const offerLetter = `${fmt(today)}

${app.candidate.name}
${app.candidate.email}
${app.candidate.phone || ''}

Dear ${app.candidate.name},

OFFER OF EMPLOYMENT — ${app.job.title.toUpperCase()}

On behalf of [Company Name], I am delighted to extend this offer of employment for the position of ${app.job.title}${app.job.department ? ` within the ${app.job.department} department` : ''}.

${performanceLine}

POSITION DETAILS
Role:           ${app.job.title}
Department:     ${app.job.department || '[Department]'}
Location:       ${app.job.location || '[Location / Remote]'}
Proposed Start: ${fmt(startDate)}
Employment Type: Full-time

COMPENSATION
Base Salary:    [To be confirmed]
Benefits:       [Health, PTO, and other benefits as per company policy]

This offer is contingent upon:
  • Successful completion of a background check
  • Submission of valid work authorisation documents
  • Signing of the company's standard confidentiality and IP agreement

Please indicate your acceptance of this offer by signing and returning this letter by ${fmt(new Date(today.setDate(today.getDate() + 7)))}.

We are excited about the prospect of you joining our team and are confident that your skills and experience will be a great asset to [Company Name].

If you have any questions, please do not hesitate to contact us.

Yours sincerely,

${hiringManagerName}
[Title]
[Company Name]
[Email] | [Phone]

---
Accepted by: ___________________________   Date: ___________
${app.candidate.name}`;

  res.json({
    candidateName: app.candidate.name,
    jobTitle: app.job.title,
    interviewRoundsCompleted: completedRounds.length,
    averageInterviewScore: avgScore,
    offerLetter,
  });
});

export default router;
