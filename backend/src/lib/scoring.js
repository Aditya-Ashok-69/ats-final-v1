// Local, dependency-free resume <-> JD matching.
// Everything here is deterministic and explainable — no external API calls.
//
// The final score is a weighted blend of three signals:
//   55% required-skill coverage
//   30% JD text similarity (TF-IDF cosine)
//   15% years-of-experience match
//
// When structured parser data is present (from the Python microservice) the
// skill coverage and experience signals are significantly more accurate:
//   • Skills are matched against the LLM-extracted skills array, not raw text.
//   • Experience uses overlap-merged calendar years, not a regex guess.
// If the parser was unreachable the function gracefully falls back to
// text-only scoring (same behaviour as before integration).

const STOPWORDS = new Set(
  ('a an and are as at be by for from has have in is it its of on or that the to with we you your this will their they ' +
    'our us i more most can may using used use across into over per such than then them these those role work team').split(' ')
);

function tokenize(text) {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

export function cosineSimilarity(textA, textB) {
  const a = tokenize(textA);
  const b = tokenize(textB);
  if (!a.length || !b.length) return 0;

  const tfA = termFreq(a);
  const tfB = termFreq(b);
  const vocab = new Set([...tfA.keys(), ...tfB.keys()]);

  const idf = (term) => {
    const df = (tfA.has(term) ? 1 : 0) + (tfB.has(term) ? 1 : 0);
    return Math.log((2 + 1) / (df + 1)) + 1;
  };

  let dot = 0, magA = 0, magB = 0;
  for (const term of vocab) {
    const w = idf(term);
    const va = (tfA.get(term) || 0) * w;
    const vb = (tfB.get(term) || 0) * w;
    dot += va * vb;
    magA += va * va;
    magB += vb * vb;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

// Which of the listed skills appear in text (word-boundary, case-insensitive).
export function matchSkills(resumeText, skills) {
  const text = (resumeText || '').toLowerCase();
  const matched = [];
  const missing = [];
  for (const skill of skills) {
    const s = skill.trim().toLowerCase();
    if (!s) continue;
    const esc = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`, 'i');
    (re.test(text) ? matched : missing).push(skill);
  }
  return { matched, missing };
}

// Best-effort "years of experience" from raw text (used as fallback).
export function extractYears(resumeText) {
  const text = (resumeText || '').toLowerCase();
  let max = 0;
  const re = /(\d{1,2})\s*\+?\s*(?:years?|yrs?)\b/g;
  let m;
  while ((m = re.exec(text)) !== null) max = Math.max(max, parseInt(m[1], 10));
  return max;
}

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Resolve experience years from structured data or fall back to regex.
 * Priority: technicalExperienceYears > totalExperienceYears > regex on raw text.
 */
function resolveExperience(structured, resumeText) {
  if (structured) {
    if (typeof structured.technical_experience_years === 'number') {
      return { years: structured.technical_experience_years, source: 'technical_structured' };
    }
    if (typeof structured.total_experience_years === 'number') {
      return { years: structured.total_experience_years, source: 'total_structured' };
    }
  }
  return { years: extractYears(resumeText), source: 'regex_fallback' };
}

/**
 * Match required/nice-to-have skills using structured skills array (if available)
 * with a fallback to raw-text matching.
 *
 * When structured, we join the parsed skills list with " | " separators so the
 * word-boundary regex in matchSkills correctly matches each skill as a whole
 * token without false positives from adjacent words.
 */
function resolveSkillMatches(structured, resumeText, requiredSkills, niceToHaveSkills) {
  if (structured?.skills?.length) {
    // Primary: match against the LLM-extracted skills list
    const skillBlob = structured.skills.join(' | ');
    const req = matchSkills(skillBlob, requiredSkills);
    const nice = matchSkills(skillBlob, niceToHaveSkills);

    // Union with text-based matches to catch any skills the LLM might have missed
    const textReq = matchSkills(resumeText, requiredSkills);
    const textNice = matchSkills(resumeText, niceToHaveSkills);

    const mergedMatched = [...new Set([...req.matched, ...textReq.matched])];
    const mergedMissing = requiredSkills.filter((s) => !mergedMatched.includes(s));
    const mergedNiceMatched = [...new Set([...nice.matched, ...textNice.matched])];

    return {
      required: { matched: mergedMatched, missing: mergedMissing },
      nice: { matched: mergedNiceMatched },
      engine: 'structured',
    };
  }

  // Fallback: text-only matching (original behaviour)
  const req = matchSkills(resumeText, requiredSkills);
  const nice = matchSkills(resumeText, niceToHaveSkills);
  return { required: req, nice, engine: 'text-only' };
}

/**
 * Score a resume against a JD. Returns a 0-100 score + explainable breakdown.
 *
 * @param {object} opts
 * @param {string}  opts.resumeText         - raw extracted text (always required for TF-IDF)
 * @param {object}  [opts.structured]       - parsed output from the Python parser (may be null)
 * @param {string[]} opts.requiredSkills
 * @param {string[]} opts.niceToHaveSkills
 * @param {number}  opts.minYearsExperience
 * @param {string}  opts.jdText
 */
export function scoreCandidate({
  resumeText = '',
  structured = null,
  requiredSkills = [],
  niceToHaveSkills = [],
  minYearsExperience = 0,
  jdText = '',
}) {
  const { required, nice, engine } = resolveSkillMatches(
    structured, resumeText, requiredSkills, niceToHaveSkills
  );

  const skillCoverage = requiredSkills.length
    ? required.matched.length / requiredSkills.length
    : 1;

  const niceBonus = niceToHaveSkills.length
    ? (nice.matched.length / niceToHaveSkills.length) * 0.1
    : 0;
  const coverageScore = Math.min(1, skillCoverage + niceBonus);

  // TF-IDF similarity always uses raw text (consistent baseline regardless of engine)
  const jdCorpus = [jdText, requiredSkills.join(' '), niceToHaveSkills.join(' ')].join(' ');
  const similarity = cosineSimilarity(resumeText, jdCorpus);

  const { years: expYears, source: experienceSource } = resolveExperience(structured, resumeText);
  const experienceMatch = minYearsExperience > 0
    ? Math.min(1, expYears / minYearsExperience)
    : 1;

  const score = clamp((coverageScore * 0.55 + similarity * 0.3 + experienceMatch * 0.15) * 100);

  return {
    score,
    breakdown: {
      engine,
      skillCoverage: clamp(coverageScore * 100),
      similarity: clamp(similarity * 100),
      experienceMatch: clamp(experienceMatch * 100),
      yearsDetected: extractYears(resumeText), // always show regex figure for transparency
      technicalExperienceYears: structured?.technical_experience_years ?? null,
      totalExperienceYears: structured?.total_experience_years ?? null,
      experienceSource,
      matchedSkills: required.matched,
      missingSkills: required.missing,
      matchedNiceToHave: nice.matched,
    },
  };
}

/**
 * Backward-compat wrapper used by seed.js and any code that hasn't migrated yet.
 * Calls scoreCandidate with structured=null (text-only path).
 */
export function scoreResume(opts) {
  return scoreCandidate({ ...opts, structured: null });
}
