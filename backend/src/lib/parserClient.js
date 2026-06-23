/**
 * HTTP client for the Python resume-parser microservice.
 *
 * The parser runs as a separate FastAPI process (default: http://localhost:8000).
 * If it is unreachable or returns an error, all functions gracefully return
 * { ok: false, reason } — the caller decides whether to fall back to
 * text-only scoring or surface an error.
 *
 * Environment:
 *   RESUME_PARSER_URL  – base URL of the parser service (optional, default localhost:8000)
 */

const PARSER_URL = process.env.RESUME_PARSER_URL || 'http://localhost:8000';
const TIMEOUT_MS = 30_000; // LLM calls can be slow; 30 s is generous

/**
 * Check if the parser service is alive (does NOT call Groq).
 * @returns {{ ok: boolean, status?: object }}
 */
export async function checkParserHealth() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5_000);
    const res = await fetch(`${PARSER_URL}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, reason: `health check HTTP ${res.status}` };
    const status = await res.json();
    return { ok: true, status };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Send a resume file buffer to the parser and get back structured JSON.
 *
 * Successful result shape (mirrors the FastAPI /extract response):
 * {
 *   ok: true,
 *   data: {
 *     name, email, phone, linkedin, github,
 *     skills: string[],
 *     work_experience: WorkEntry[],
 *     internships: WorkEntry[],
 *     education: EducationEntry[],
 *     certifications: string[],
 *     projects: any[],
 *     total_experience_years: number,
 *     technical_experience_years: number,
 *     raw_text: string,          // extracted text included by app.py for Node's TF-IDF
 *   }
 * }
 *
 * On any failure: { ok: false, reason: string }
 *
 * @param {Buffer} fileBuffer
 * @param {string} originalName
 */
export async function parseResumeStructured(fileBuffer, originalName) {
  try {
    const form = new FormData();
    form.append(
      'file',
      new Blob([fileBuffer], { type: mimeTypeFor(originalName) }),
      originalName
    );

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    const res = await fetch(`${PARSER_URL}/extract`, {
      method: 'POST',
      body: form,
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const json = await res.json();

    if (!res.ok) {
      // Parser returned 4xx/5xx — error detail is in json.detail or json.error
      const reason = json?.detail || json?.error || `parser HTTP ${res.status}`;
      return { ok: false, reason };
    }

    if (json.error) {
      // 200 body that still has an "error" key (parser's own error convention)
      return { ok: false, reason: json.error };
    }

    return { ok: true, data: json };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

function mimeTypeFor(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  return 'application/octet-stream';
}
