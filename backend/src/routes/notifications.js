import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const unread = notifications.filter((n) => !n.read).length;
  res.json({ notifications, unread });
});

router.patch('/:id/read', async (req, res) => {
  try {
    const n = await prisma.notification.update({
      where: { id: req.params.id },
      data: { read: true },
    });
    if (n.userId !== req.user.id) return res.status(403).json({ error: "Not your notification." });
    res.json(n);
  } catch {
    res.status(404).json({ error: 'Notification not found.' });
  }
});

router.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.id, read: false },
    data: { read: true },
  });
  res.json({ ok: true });
});

export default router;
