import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';

import authRoutes from './routes/auth.js';
import jobRoutes from './routes/jobs.js';
import candidateRoutes from './routes/candidates.js';
import applicationRoutes from './routes/applications.js';
import dashboardRoutes from './routes/dashboard.js';
import publicRoutes from './routes/public.js';
import interviewRoutes from './routes/interviews.js';
import notificationRoutes from './routes/notifications.js';
import userRoutes from './routes/users.js';
import rankingRoutes from './routes/ranking.js';
import jdParserRoutes from './routes/jdParser.js';

const app = express();
app.use(cors());
app.use(express.json());

// Serve uploaded resumes.
app.use('/uploads', express.static(path.resolve('uploads')));

app.get('/api/health', (_req, res) => res.json({ ok: true }));

app.use('/api/auth', authRoutes);
app.use('/api/jobs', jobRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/applications', applicationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/interviews', interviewRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ranking', rankingRoutes);   // ← resume-score ranking + bulk advance
app.use('/api/jd', jdParserRoutes);       // ← JD document → structured fields

// Fallback error handler.
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our end.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`ATS API running on http://localhost:${PORT}`));
