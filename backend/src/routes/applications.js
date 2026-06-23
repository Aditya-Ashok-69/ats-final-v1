import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isValidStage, PIPELINE_STAGES } from '../lib/constants.js';
import { notifyUser, buildCandidateEmail } from '../lib/notify.js';

const router = Router();
router.use(requireAuth);

// Board view: all applications for a job, grouped by stage (for the Kanban).
router.get('/board/:jobId', async (req, res) => {
  const applications = await prisma.application.findMany({
    where: { jobId: req.params.jobId },
    include: {
      candidate: { select: { id: true, name: true, email: true, source: true } },
      owner: { select: { id: true, name: true } },
      _count: { select: { notes: true, ratings: true } },
    },
    orderBy: { updatedAt: 'desc' },
  });

  // Initialise every pipeline column so empty columns still render.
  const board = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, []]));
  board.REJECTED = [];
  for (const app of applications) {
    (board[app.stage] ||= []).push(app);
  }
  res.json(board);
});

// Create an application (apply a candidate to a job).
const applySchema = z.object({
  candidateId: z.string().min(1),
  jobId: z.string().min(1),
  ownerId: z.string().optional().nullable(),
});

router.post('/', requireRole('ADMIN', 'RECRUITER'), async (req, res) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Pick a candidate and a job.' });

  try {
    const application = await prisma.application.create({
      data: { ...parsed.data, stage: 'APPLIED' },
      include: { candidate: true, job: true },
    });
    await prisma.activityLog.create({
      data: {
        applicationId: application.id,
        actorId: req.user.id,
        action: 'CREATED',
        toStage: 'APPLIED',
      },
    });
    res.status(201).json(application);
  } catch (e) {
    if (e.code === 'P2002') {
      return res.status(409).json({ error: 'That candidate is already in the pipeline for this job.' });
    }
    res.status(400).json({ error: 'Could not create the application.' });
  }
});

// Full application detail with timeline.
router.get('/:id', async (req, res) => {
  const application = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: {
      candidate: true,
      job: { select: { id: true, title: true, shortlistThreshold: true, maxInterviewRounds: true, autoAdvanceThreshold: true } },
      owner: { select: { id: true, name: true } },
      notes: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      ratings: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      interviews: {
        include: { interviewer: { select: { id: true, name: true } }, scorecard: true },
        orderBy: { scheduledAt: 'desc' },
      },
      activityLogs: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' } },
      handoff: true,
    },
  });
  if (!application) return res.status(404).json({ error: 'Application not found.' });
  res.json({
    ...application,
    matchBreakdown: application.matchBreakdown ? JSON.parse(application.matchBreakdown) : null,
  });
});

// Move a candidate to a new stage — the core pipeline action.
const stageSchema = z.object({ stage: z.string() });

router.patch('/:id/stage', async (req, res) => {
  const parsed = stageSchema.safeParse(req.body);
  if (!parsed.success || !isValidStage(parsed.data.stage)) {
    return res.status(400).json({ error: 'That is not a valid pipeline stage.' });
  }

  const current = await prisma.application.findUnique({ where: { id: req.params.id } });
  if (!current) return res.status(404).json({ error: 'Application not found.' });
  if (current.stage === parsed.data.stage) return res.json(current);

  const [application] = await prisma.$transaction([
    prisma.application.update({
      where: { id: req.params.id },
      data: { stage: parsed.data.stage },
    }),
    prisma.activityLog.create({
      data: {
        applicationId: req.params.id,
        actorId: req.user.id,
        action: 'STAGE_CHANGED',
        fromStage: current.stage,
        toStage: parsed.data.stage,
      },
    }),
  ]);
  res.json(application);
});

// Notes
router.post('/:id/notes', async (req, res) => {
  const body = z.object({ body: z.string().min(1) }).safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Write something before saving.' });

  const note = await prisma.note.create({
    data: { applicationId: req.params.id, authorId: req.user.id, body: body.data.body },
    include: { author: { select: { name: true } } },
  });
  await prisma.activityLog.create({
    data: { applicationId: req.params.id, actorId: req.user.id, action: 'NOTE_ADDED' },
  });
  res.status(201).json(note);
});

// Ratings
router.post('/:id/ratings', async (req, res) => {  const parsed = z
    .object({ score: z.number().int().min(1).max(5), criteria: z.string().optional() })
    .safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Give a score from 1 to 5.' });

  const rating = await prisma.rating.create({
    data: { applicationId: req.params.id, authorId: req.user.id, ...parsed.data },
    include: { author: { select: { name: true } } },
  });
  res.status(201).json(rating);
});

// Assign an interview: pick interviewer + time, move to INTERVIEW stage, notify.
const interviewSchema = z.object({
  interviewerId: z.string().min(1),
  scheduledAt: z.string().min(1), // ISO string
  round: z.number().int().min(1).optional(),
});

router.post('/:id/interviews', requireRole('ADMIN', 'RECRUITER', 'HIRING_MANAGER'), async (req, res) => {
  const parsed = interviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Pick an interviewer and a time.' });

  const application = await prisma.application.findUnique({
    where: { id: req.params.id },
    include: { job: true, candidate: true },
  });
  if (!application) return res.status(404).json({ error: 'Application not found.' });

  const round = parsed.data.round || application.currentRound + 1 || 1;
  const interview = await prisma.interview.create({
    data: {
      applicationId: application.id,
      interviewerId: parsed.data.interviewerId,
      scheduledAt: new Date(parsed.data.scheduledAt),
      round,
    },
    include: { interviewer: { select: { name: true } } },
  });

  await prisma.application.update({
    where: { id: application.id },
    data: { stage: 'INTERVIEW', currentRound: round },
  });

  await prisma.activityLog.create({
    data: {
      applicationId: application.id,
      actorId: req.user.id,
      action: 'INTERVIEW_SCHEDULED',
      toStage: 'INTERVIEW',
    },
  });

  await notifyUser(
    parsed.data.interviewerId,
    'INTERVIEW_ASSIGNED',
    `You're interviewing ${application.candidate.name} for ${application.job.title} (round ${round}).`,
    `/jobs/${application.jobId}`
  );

  const emailDraft = buildCandidateEmail({
    kind: 'INTERVIEW',
    candidateName: application.candidate.name,
    jobTitle: application.job.title,
    interviewAt: interview.scheduledAt,
  });

  res.status(201).json({ interview, emailDraft });
});

export default router;
