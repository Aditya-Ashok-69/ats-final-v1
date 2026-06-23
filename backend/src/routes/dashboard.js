import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { STAGES } from '../lib/constants.js';

const router = Router();
router.use(requireAuth);

router.get('/stats', async (_req, res) => {
  const [openJobs, totalCandidates, byStageRaw, hired, scoredApps] = await Promise.all([
    prisma.job.count({ where: { status: 'OPEN' } }),
    prisma.candidate.count(),
    prisma.application.groupBy({ by: ['stage'], _count: true }),
    prisma.application.count({ where: { stage: 'HIRED' } }),
    // Fetch match scores for the distribution histogram (only scored apps)
    prisma.application.findMany({
      where: { matchScore: { not: null } },
      select: { matchScore: true },
    }),
  ]);

  const byStage = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const row of byStageRaw) byStage[row.stage] = row._count;

  // Build score distribution in 10-point buckets: 0-9, 10-19, …, 90-100
  const buckets = Array.from({ length: 10 }, (_, i) => ({
    label: i === 9 ? '90-100' : `${i * 10}-${i * 10 + 9}`,
    min: i * 10,
    max: i === 9 ? 100 : i * 10 + 9,
    count: 0,
  }));
  for (const { matchScore } of scoredApps) {
    const idx = Math.min(9, Math.floor(matchScore / 10));
    buckets[idx].count++;
  }

  res.json({
    openJobs,
    totalCandidates,
    hired,
    activeApplications: byStageRaw.reduce(
      (sum, r) => sum + (r.stage === 'HIRED' || r.stage === 'REJECTED' ? 0 : r._count),
      0
    ),
    byStage,
    scoreDistribution: buckets,
  });
});

export default router;
