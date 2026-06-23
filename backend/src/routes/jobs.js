import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { JOB_STATUSES } from '../lib/constants.js';
import { scoreCandidate } from '../lib/scoring.js';

const router = Router();
router.use(requireAuth);

const jobSchema = z.object({
  title: z.string().min(1),
  department: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  status: z.enum(['OPEN', 'ON_HOLD', 'CLOSED']).optional(),
  hiringManagerId: z.string().optional().nullable(),
  requiredSkills: z.array(z.string()).optional(),
  niceToHaveSkills: z.array(z.string()).optional(),
  minYearsExperience: z.number().int().min(0).optional(),
  scoreThreshold: z.number().int().min(0).max(100).optional(),
  shortlistThreshold: z.number().int().min(0).max(100).optional(),
  maxInterviewRounds: z.number().int().min(0).max(20).optional(),
  autoAdvanceThreshold: z.number().int().min(0).max(100).optional(),
});

function toDbData(data) {
  const out = { ...data };
  if (Array.isArray(out.requiredSkills)) out.requiredSkills = JSON.stringify(out.requiredSkills);
  if (Array.isArray(out.niceToHaveSkills)) out.niceToHaveSkills = JSON.stringify(out.niceToHaveSkills);
  return out;
}

function fromDbJob(job) {
  return {
    ...job,
    requiredSkills: JSON.parse(job.requiredSkills || '[]'),
    niceToHaveSkills: JSON.parse(job.niceToHaveSkills || '[]'),
  };
}

const parseJson = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

/**
 * Re-score every application for a job after its JD config changes.
 * Runs in the background — doesn't block the PATCH response.
 * Each application's matchScore, matchBreakdown, and flaggedForReview are updated.
 */
async function rescoreApplications(jobId) {
  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return;

  const requiredSkills = parseJson(job.requiredSkills, []);
  const niceToHaveSkills = parseJson(job.niceToHaveSkills, []);

  const applications = await prisma.application.findMany({
    where: { jobId },
    include: {
      candidate: {
        select: {
          resumeText: true,
          skills: true,
          totalExperienceYears: true,
          technicalExperienceYears: true,
          parseEngine: true,
        },
      },
    },
  });

  // Re-score all in parallel, then bulk-update
  const updates = await Promise.all(
    applications.map(async (app) => {
      const c = app.candidate;

      // Reconstruct structured data shape if the candidate was parsed by the LLM
      const structured =
        c.parseEngine === 'structured'
          ? {
              skills: parseJson(c.skills, []),
              total_experience_years: c.totalExperienceYears,
              technical_experience_years: c.technicalExperienceYears,
            }
          : null;

      const { score, breakdown } = scoreCandidate({
        resumeText: c.resumeText || '',
        structured,
        requiredSkills,
        niceToHaveSkills,
        minYearsExperience: job.minYearsExperience,
        jdText: job.description || '',
      });

      return {
        id: app.id,
        score,
        breakdown: JSON.stringify(breakdown),
        flagged: score < job.scoreThreshold,
      };
    })
  );

  // Single transaction — all or nothing
  await prisma.$transaction(
    updates.map((u) =>
      prisma.application.update({
        where: { id: u.id },
        data: {
          matchScore: u.score,
          matchBreakdown: u.breakdown,
          flaggedForReview: u.flagged,
        },
      })
    )
  );

  console.log(`[rescore] Job ${jobId}: re-scored ${updates.length} applications.`);
}

// Scoring-relevant fields — changing any of these triggers a rescore
const RESCORE_FIELDS = new Set([
  'requiredSkills', 'niceToHaveSkills', 'minYearsExperience',
  'scoreThreshold', 'description',
]);

router.get('/', async (req, res) => {
  const { status } = req.query;
  const jobs = await prisma.job.findMany({
    where: status && JOB_STATUSES.includes(status) ? { status } : undefined,
    orderBy: { createdAt: 'desc' },
    include: {
      hiringManager: { select: { id: true, name: true } },
      _count: { select: { applications: true } },
    },
  });
  res.json(jobs);
});

router.get('/:id', async (req, res) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    include: { hiringManager: { select: { id: true, name: true } } },
  });
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(fromDbJob(job));
});

router.post('/', requireRole('ADMIN', 'RECRUITER'), async (req, res) => {
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A job needs at least a title.' });
  const job = await prisma.job.create({ data: toDbData(parsed.data) });
  res.status(201).json(fromDbJob(job));
});

router.patch('/:id', requireRole('ADMIN', 'RECRUITER'), async (req, res) => {
  const parsed = jobSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Some fields are invalid.' });
  try {
    const job = await prisma.job.update({ where: { id: req.params.id }, data: toDbData(parsed.data) });
    const result = fromDbJob(job);

    // Trigger async rescore if any scoring-relevant field changed
    const needsRescore = Object.keys(parsed.data).some((k) => RESCORE_FIELDS.has(k));
    if (needsRescore) {
      rescoreApplications(req.params.id).catch((e) =>
        console.error('[rescore] Background rescore failed:', e.message)
      );
      result._rescoring = true; // hint for the frontend
    }

    res.json(result);
  } catch {
    res.status(404).json({ error: 'Job not found.' });
  }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.job.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Job not found.' })
  }
});

export default router;
