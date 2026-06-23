/**
 * Resume-score ranking and bulk-advance routes.
 *
 * GET  /ranking/:jobId          – ranked list of all applicants for a job, sorted by matchScore
 * POST /ranking/:jobId/advance  – bulk-advance selected application IDs to a target stage
 */

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { isValidStage } from '../lib/constants.js';

const router = Router();
router.use(requireAuth);

const parseJson = (s, fallback) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

/**
 * GET /ranking/:jobId
 *
 * Returns all applications for the job, sorted by matchScore descending.
 * Includes candidate name, score, score breakdown (parsed), stage, flags.
 * Also returns job metadata so the frontend can render the threshold line.
 *
 * Query params:
 *   stage   – filter by one stage (optional)
 *   minScore – only return applications with matchScore >= N (optional)
 */
router.get('/:jobId', async (req, res) => {
  const { jobId } = req.params;
  const minScore = req.query.minScore ? parseInt(req.query.minScore, 10) : null;
  const stageFilter = req.query.stage || null;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  const where = { jobId };
  if (stageFilter) where.stage = stageFilter;
  if (minScore !== null && !isNaN(minScore)) where.matchScore = { gte: minScore };

  const applications = await prisma.application.findMany({
    where,
    include: {
      candidate: {
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          resumeUrl: true,
          source: true,
          skills: true,
          totalExperienceYears: true,
          technicalExperienceYears: true,
          parseEngine: true,
        },
      },
      _count: { select: { notes: true, interviews: true } },
    },
    orderBy: [{ matchScore: 'desc' }, { appliedAt: 'asc' }],
  });

  const ranked = applications.map((app, idx) => ({
    rank: idx + 1,
    id: app.id,
    stage: app.stage,
    matchScore: app.matchScore,
    flaggedForReview: app.flaggedForReview,
    appliedAt: app.appliedAt,
    breakdown: parseJson(app.matchBreakdown, null),
    candidate: {
      ...app.candidate,
      skills: parseJson(app.candidate.skills, []),
    },
    notesCount: app._count.notes,
    interviewsCount: app._count.interviews,
  }));

  res.json({
    job: {
      id: job.id,
      title: job.title,
      department: job.department,
      scoreThreshold: job.scoreThreshold,
      shortlistThreshold: job.shortlistThreshold,
      minYearsExperience: job.minYearsExperience,
      requiredSkills: parseJson(job.requiredSkills, []),
      niceToHaveSkills: parseJson(job.niceToHaveSkills, []),
    },
    total: ranked.length,
    ranked,
  });
});

/**
 * POST /ranking/:jobId/advance
 *
 * Bulk-advance a set of applications to a new stage.
 * Body: { applicationIds: string[], toStage: string }
 *
 * Each application gets:
 *   - stage updated
 *   - an ActivityLog entry (action: STAGE_CHANGED)
 */
const advanceSchema = z.object({
  applicationIds: z.array(z.string().min(1)).min(1),
  toStage: z.string(),
});

router.post('/:jobId/advance', requireRole('ADMIN', 'RECRUITER', 'HIRING_MANAGER'), async (req, res) => {
  const parsed = advanceSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Provide at least one applicationId and a valid toStage.' });
  }

  const { applicationIds, toStage } = parsed.data;

  if (!isValidStage(toStage)) {
    return res.status(400).json({ error: `"${toStage}" is not a valid pipeline stage.` });
  }

  // Fetch current stages to log transitions and skip already-at-target
  const existing = await prisma.application.findMany({
    where: { id: { in: applicationIds }, jobId: req.params.jobId },
    select: { id: true, stage: true },
  });

  if (!existing.length) {
    return res.status(404).json({ error: 'None of the specified applications were found for this job.' });
  }

  const toUpdate = existing.filter((a) => a.stage !== toStage);

  if (!toUpdate.length) {
    return res.json({ advanced: 0, message: 'All selected candidates are already in that stage.' });
  }

  // Run all updates in a single transaction
  const ops = toUpdate.flatMap((app) => [
    prisma.application.update({
      where: { id: app.id },
      data: { stage: toStage },
    }),
    prisma.activityLog.create({
      data: {
        applicationId: app.id,
        actorId: req.user.id,
        action: 'STAGE_CHANGED',
        fromStage: app.stage,
        toStage,
      },
    }),
  ]);

  await prisma.$transaction(ops);

  res.json({
    advanced: toUpdate.length,
    skipped: existing.length - toUpdate.length,
    toStage,
    applicationIds: toUpdate.map((a) => a.id),
  });
});

export default router;
