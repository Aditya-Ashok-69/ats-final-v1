import { Router } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { prisma } from '../lib/prisma.js';
import { parseResume } from '../lib/resume.js';
import { scoreCandidate } from '../lib/scoring.js';
import { notifyJobStakeholders, buildCandidateEmail } from '../lib/notify.js';
import { parseResumeStructured } from '../lib/parserClient.js';

const router = Router();

const UPLOAD_DIR = path.resolve('uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
});

const parseJson = (s, fallback) => {
  try { return JSON.parse(s); } catch { return fallback; }
};

// Public job info for the application form.
router.get('/jobs/:id', async (req, res) => {
  const job = await prisma.job.findUnique({
    where: { id: req.params.id },
    select: { id: true, title: true, department: true, location: true, description: true, status: true },
  });
  if (!job || job.status === 'CLOSED') return res.status(404).json({ error: 'This role is not accepting applications.' });
  res.json(job);
});

// Candidate applies: details + resume -> parsed (structured or text), scored, routed.
router.post('/jobs/:id/apply', upload.single('resume'), async (req, res) => {
  const { name, email, phone } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'Name and email are required.' });

  const job = await prisma.job.findUnique({ where: { id: req.params.id } });
  if (!job || job.status === 'CLOSED') return res.status(404).json({ error: 'This role is not accepting applications.' });

  // --- Parse the resume ---
  let resumeText = '';
  let resumeUrl = null;
  let structuredData = null;   // structured output from the Python parser (or null)
  let parseEngine = null;

  if (req.file) {
    // Save the file first (we need the buffer for both parsers)
    const safe = `${Date.now()}-${req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_')}`;
    fs.writeFileSync(path.join(UPLOAD_DIR, safe), req.file.buffer);
    resumeUrl = `/uploads/${safe}`;

    // Try the hardened Python microservice first
    const parserResult = await parseResumeStructured(req.file.buffer, req.file.originalname);

    if (parserResult.ok) {
      // Structured path: get text + structured JSON from the one call
      structuredData = parserResult.data;
      resumeText = parserResult.data.raw_text || '';
      parseEngine = 'structured';
    } else {
      // Fallback: local text extraction (mammoth / unpdf)
      console.warn('[apply] Hardened parser unavailable, falling back to text extraction:', parserResult.reason);
      resumeText = await parseResume(req.file.buffer, req.file.originalname);
      parseEngine = 'fallback';
    }
  }

  // --- Find-or-create the candidate ---
  let candidate = await prisma.candidate.findFirst({ where: { email } });

  const structuredFields = structuredData
    ? {
        skills: JSON.stringify(structuredData.skills || []),
        workExperience: JSON.stringify(structuredData.work_experience || []),
        internships: JSON.stringify(structuredData.internships || []),
        education: JSON.stringify(structuredData.education || []),
        certifications: JSON.stringify(structuredData.certifications || []),
        totalExperienceYears: structuredData.total_experience_years ?? null,
        technicalExperienceYears: structuredData.technical_experience_years ?? null,
        parseEngine,
        parsedAt: new Date(),
      }
    : { parseEngine, parsedAt: req.file ? new Date() : undefined };

  if (candidate) {
    candidate = await prisma.candidate.update({
      where: { id: candidate.id },
      data: {
        name,
        phone,
        resumeText: resumeText || undefined,
        resumeUrl: resumeUrl || undefined,
        ...structuredFields,
      },
    });
  } else {
    candidate = await prisma.candidate.create({
      data: {
        name,
        email,
        phone,
        resumeText,
        resumeUrl,
        source: 'Careers Page',
        ...structuredFields,
      },
    });
  }

  // Guard against duplicate application.
  const dupe = await prisma.application.findFirst({ where: { candidateId: candidate.id, jobId: job.id } });
  if (dupe) return res.status(409).json({ error: `It looks like  has already been used to apply for this role. If this wasn't you, please contact the hiring team.`, code: 'DUPLICATE_APPLICATION' });

  // --- Score: structured > fallback ---
  const { score, breakdown } = scoreCandidate({
    resumeText,
    structured: structuredData,
    requiredSkills: parseJson(job.requiredSkills, []),
    niceToHaveSkills: parseJson(job.niceToHaveSkills, []),
    minYearsExperience: job.minYearsExperience,
    jdText: job.description || '',
  });

  const passes = score >= job.scoreThreshold;
  const stage = passes ? 'SCREENING' : 'APPLIED';

  const application = await prisma.application.create({
    data: {
      candidateId: candidate.id,
      jobId: job.id,
      stage,
      matchScore: score,
      matchBreakdown: JSON.stringify(breakdown),
      flaggedForReview: !passes,
    },
  });

  await prisma.activityLog.create({
    data: {
      applicationId: application.id,
      action: passes ? 'AUTO_ADVANCED' : 'FLAGGED_FOR_REVIEW',
      toStage: stage,
    },
  });

  await notifyJobStakeholders({
    job,
    type: passes ? 'NEW_APPLICANT' : 'FLAGGED',
    message: passes
      ? `${name} applied for ${job.title} and scored ${score}/100 — auto-advanced to Screening.`
      : `${name} applied for ${job.title} and scored ${score}/100 — flagged for manual review.`,
    link: `/jobs/${job.id}`,
  });

  const emailDraft = buildCandidateEmail({
    kind: passes ? 'ADVANCED' : 'REVIEW',
    candidateName: name,
    jobTitle: job.title,
  });

  res.status(201).json({
    applicationId: application.id,
    score,
    advanced: passes,
    engine: parseEngine,
    message: passes
      ? 'Thanks for applying. Your application looks like a strong match and has moved to screening.'
      : 'Thanks for applying. Your application has been received and is under review.',
    emailDraft,
  });
});

export default router;
