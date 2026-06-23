# Hiretrack ATS — Integrated with Hardened Resume Parser

A full-stack ATS with LLM-powered resume parsing, JD-matching scores, and a ranked shortlisting view.

## Architecture

```
resume-parser/  (Python FastAPI + Groq LLM, port 8000)
     ▲ HTTP multipart upload — internal only
     │
backend/        (Node/Express + Prisma/SQLite, port 4000)
     │  lib/parserClient.js → calls /extract, falls back gracefully
     │  lib/scoring.js      → structured skills + tech-exp-years, or text-only
     ▼
frontend/       (React + Vite, port 5173)
     /jobs/:id           — Kanban board (existing)
     /jobs/:id/ranked    — NEW: ranked table + bulk-advance
```

## Quick Start

### 1 — Resume Parser (Python)

```bash
cd resume-parser
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env — set GROQ_API_KEY=gsk_...
uvicorn app:app --reload --port 8000
```

Verify: `curl http://localhost:8000/health`  → `{"status":"ok","groq_key_configured":true}`

### 2 — Backend (Node)

```bash
cd backend
cp .env.example .env        # DATABASE_URL, JWT_SECRET, RESUME_PARSER_URL
npm install
npx prisma migrate dev      # requires internet once to download the Prisma engine binary
npx prisma db seed          # optional demo data
npm run dev
```

### 3 — Frontend (React)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and log in with the seeded admin account.

---

## What was integrated / changed

### resume-parser/app.py
- Added `GET /health` — liveness check, no Groq dependency.
- `/extract` response now includes `raw_text` (the extracted text) alongside the
  structured JSON, so the Node backend can do TF-IDF JD-similarity scoring without
  re-parsing the file a second time.

### backend/prisma/schema.prisma + migration
New columns on `Candidate`:
`skills · workExperience · internships · education · certifications`
`totalExperienceYears · technicalExperienceYears · parseEngine · parsedAt`

Migration SQL pre-written at `prisma/migrations/20260619090000_add_structured_resume_fields/`.

### backend/src/lib/parserClient.js  *(new)*
HTTP client with 30-second timeout. Returns `{ ok, data }` or `{ ok: false, reason }` —
the caller always handles the failure case and falls back to text-only scoring.

### backend/src/lib/scoring.js
Extended `scoreCandidate()` (new export) that uses:
- LLM-extracted skills list **∪** text-matched skills for coverage (much more accurate).
- `technical_experience_years` (overlap-merged calendar years, IT roles only)
  → `total_experience_years` → regex guess, in priority order.

Old `scoreResume()` kept as a thin backward-compatible wrapper (seed.js still works).

### backend/src/routes/public.js
`POST /api/public/jobs/:id/apply`:
1. Tries the Python parser microservice.
2. On success: stores structured fields + raw text, scores with `scoreCandidate()`.
3. On failure: falls back to local text extraction + text-only scoring.
Threshold-based auto-advance to SCREENING is preserved.

### backend/src/routes/ranking.js  *(new)*
```
GET  /api/ranking/:jobId            — ranked applicants, sorted by score desc
POST /api/ranking/:jobId/advance    — bulk-advance selected IDs to a stage
```

### frontend/src/pages/RankedCandidates.jsx  *(new)*
- Sortable table with rank, score pill, stage badge, engine indicator (⚡ AI / Text).
- Expandable row showing score breakdown bars + matched/missing skill chips.
- Selection helpers: All · ≥ Threshold · Top N.
- Bulk advance: pick a stage, hit Advance — logs STAGE_CHANGED for each.

### frontend/src/pages/JobBoard.jsx
Added **📊 Ranked view** button in the job board header.

---

## Scoring logic

```
Final score = (skill_coverage × 0.55) + (jd_similarity × 0.30) + (experience_match × 0.15)
```

| Signal | Structured engine | Text-only fallback |
|---|---|---|
| Skill coverage | LLM skills list ∪ text match | Raw text regex |
| Experience years | `technical_experience_years` (overlap-merged, tech roles only) | Regex on raw text |
| JD similarity | TF-IDF cosine on raw text | same |

The `engine` field in `matchBreakdown` tells you which path was taken.

---

## Ranking & Shortlisting Flow

1. Candidates apply → resumes parsed → scored → stored.
2. Recruiter opens **Jobs → [job] → 📊 Ranked view**.
3. Filter by stage and/or minimum score.
4. Select candidates using:  All · ≥ Threshold (e.g. ≥70) · Top N.
5. Choose a target stage (Screening, Interview, Offer…) and click **Advance →**.
6. Each candidate's stage is updated and logged in the activity timeline.
