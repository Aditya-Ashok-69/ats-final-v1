/**
 * POST /api/jd/parse
 *
 * Upload a PDF or DOCX job description.
 * Extracts raw text, then calls Groq (same key as the Python parser) to pull out:
 *   title, department, location, description, requiredSkills,
 *   niceToHaveSkills, minYearsExperience
 */

import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = process.env.GROQ_API_KEY || '';

// ── Text extraction ────────────────────────────────────────────────────────────

async function extractTextFromDocx(buffer) {
  const { default: mammoth } = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value;
}

async function extractTextFromPdf(buffer) {
  const { extractText } = await import('unpdf');
  const uint8 = new Uint8Array(buffer);
  const { text } = await extractText(uint8, { mergePages: true });
  return text;
}

async function extractText(buffer, originalName) {
  const ext = originalName.split('.').pop().toLowerCase();
  if (ext === 'docx') return extractTextFromDocx(buffer);
  if (ext === 'pdf')  return extractTextFromPdf(buffer);
  throw new Error('Only PDF and DOCX files are supported.');
}

// ── Groq LLM call ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a job description parser. Given raw text from a job description document, extract structured data and return ONLY a valid JSON object with exactly these fields:

{
  "title": "job title (string)",
  "department": "department name or null",
  "location": "location or null",
  "description": "2-4 sentence summary of the role suitable for a job board (string)",
  "requiredSkills": ["array", "of", "required", "skill", "strings"],
  "niceToHaveSkills": ["array", "of", "preferred", "or", "nice-to-have", "skill", "strings"],
  "minYearsExperience": 0
}

Rules:
- requiredSkills: concrete technical skills only (languages, frameworks, tools, platforms). No soft skills. Max 15 items.
- niceToHaveSkills: clearly optional/preferred skills marked as "nice to have", "a plus", "familiarity with", "preferred". Max 10 items.
- minYearsExperience: lowest explicit years number mentioned (e.g. "5-8 years" → 5). 0 if not stated.
- description: concise role summary, do not copy bullet lists verbatim.
- Return ONLY the JSON object. No markdown fences, no explanation.`;

async function parseJdWithGroq(text) {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY is not set in the backend .env file.');

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Parse this job description:\n\n${text.slice(0, 8000)}` },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq API error ${response.status}: ${err.slice(0, 200)}`);
  }

  const data = await response.json();
  const raw = data.choices?.[0]?.message?.content || '';

  // Strip accidental markdown fences
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    title:               parsed.title || '',
    department:          parsed.department || '',
    location:            parsed.location || '',
    description:         parsed.description || '',
    requiredSkills:      Array.isArray(parsed.requiredSkills)    ? parsed.requiredSkills    : [],
    niceToHaveSkills:    Array.isArray(parsed.niceToHaveSkills)  ? parsed.niceToHaveSkills  : [],
    minYearsExperience:  typeof parsed.minYearsExperience === 'number' ? parsed.minYearsExperience : 0,
  };
}

// ── Route ──────────────────────────────────────────────────────────────────────

router.post('/parse', requireRole('ADMIN', 'RECRUITER'), upload.single('jd'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload a PDF or DOCX job description file.' });

  let text;
  try {
    text = await extractText(req.file.buffer, req.file.originalname);
  } catch (e) {
    return res.status(422).json({ error: `Could not read file: ${e.message}` });
  }

  if (!text || text.trim().length < 50) {
    return res.status(422).json({ error: 'The document appears to be empty or unreadable.' });
  }

  let parsed;
  try {
    parsed = await parseJdWithGroq(text);
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }

  res.json({ ...parsed, rawTextLength: text.length });
});

export default router;