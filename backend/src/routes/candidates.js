import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const candidateSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().nullable(),
  resumeUrl: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
});

// List / search candidates by name or email.
router.get('/', async (req, res) => {
  const { q } = req.query;
  const candidates = await prisma.candidate.findMany({
    where: q
      ? { OR: [{ name: { contains: q } }, { email: { contains: q } }] }
      : undefined,
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { applications: true } } },
  });
  res.json(candidates);
});

router.get('/:id', async (req, res) => {
  const candidate = await prisma.candidate.findUnique({
    where: { id: req.params.id },
    include: {
      applications: {
        include: { job: { select: { id: true, title: true } } },
        orderBy: { appliedAt: 'desc' },
      },
    },
  });
  if (!candidate) return res.status(404).json({ error: 'Candidate not found.' });
  res.json(candidate);
});

router.post('/', requireRole('ADMIN', 'RECRUITER'), async (req, res) => {
  const parsed = candidateSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'A candidate needs a name and valid email.' });
  const candidate = await prisma.candidate.create({ data: parsed.data });
  res.status(201).json(candidate);
});

router.patch('/:id', requireRole('ADMIN', 'RECRUITER'), async (req, res) => {
  const parsed = candidateSchema.partial().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Some fields are invalid.' });
  try {
    const candidate = await prisma.candidate.update({ where: { id: req.params.id }, data: parsed.data });
    res.json(candidate);
  } catch {
    res.status(404).json({ error: 'Candidate not found.' });
  }
});

router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  try {
    await prisma.candidate.delete({ where: { id: req.params.id } });
    res.status(204).end();
  } catch {
    res.status(404).json({ error: 'Candidate not found.' });
  }
});

export default router;

/**
 * POST /api/candidates/merge
 * Merge two candidate records into one. The "primary" candidate keeps its id;
 * all applications, notes, ratings, and activity logs from the "duplicate"
 * are re-assigned to the primary. The duplicate record is then deleted.
 *
 * Body: { primaryId: string, duplicateId: string }
 *
 * Conflicts (same candidate applied to same job twice) are skipped — the
 * primary's application is kept and the duplicate's is deleted.
 */
router.post('/merge', requireRole('ADMIN', 'RECRUITER'), async (req, res) => {
  const schema = z.object({
    primaryId: z.string().min(1),
    duplicateId: z.string().min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Provide primaryId and duplicateId.' });

  const { primaryId, duplicateId } = parsed.data;
  if (primaryId === duplicateId) return res.status(400).json({ error: 'Primary and duplicate must be different candidates.' });

  const [primary, duplicate] = await Promise.all([
    prisma.candidate.findUnique({ where: { id: primaryId }, include: { applications: { select: { jobId: true, id: true } } } }),
    prisma.candidate.findUnique({ where: { id: duplicateId }, include: { applications: { select: { jobId: true, id: true } } } }),
  ]);
  if (!primary) return res.status(404).json({ error: 'Primary candidate not found.' });
  if (!duplicate) return res.status(404).json({ error: 'Duplicate candidate not found.' });

  const primaryJobIds = new Set(primary.applications.map((a) => a.jobId));

  // Applications from duplicate that conflict with primary (same job) → delete them
  const conflictAppIds = duplicate.applications
    .filter((a) => primaryJobIds.has(a.jobId))
    .map((a) => a.id);

  // Applications from duplicate that don't conflict → re-assign to primary
  const transferAppIds = duplicate.applications
    .filter((a) => !primaryJobIds.has(a.jobId))
    .map((a) => a.id);

  await prisma.$transaction([
    // Delete conflict applications (cascades notes/ratings/logs/interviews)
    ...(conflictAppIds.length
      ? [prisma.application.deleteMany({ where: { id: { in: conflictAppIds } } })]
      : []),

    // Re-assign clean applications to primary
    ...(transferAppIds.length
      ? [prisma.application.updateMany({ where: { id: { in: transferAppIds } }, data: { candidateId: primaryId } })]
      : []),

    // Update primary with any missing info from duplicate (fill blanks only)
    prisma.candidate.update({
      where: { id: primaryId },
      data: {
        phone: primary.phone || duplicate.phone || undefined,
        resumeUrl: primary.resumeUrl || duplicate.resumeUrl || undefined,
        resumeText: primary.resumeText || duplicate.resumeText || undefined,
        source: primary.source || duplicate.source || undefined,
      },
    }),

    // Delete the duplicate (remaining relations cascade)
    prisma.candidate.delete({ where: { id: duplicateId } }),
  ]);

  res.json({
    merged: true,
    primaryId,
    transferredApplications: transferAppIds.length,
    deletedConflictApplications: conflictAppIds.length,
  });
});
