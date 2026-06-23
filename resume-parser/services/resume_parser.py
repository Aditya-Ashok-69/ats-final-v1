import os
import json
import time
import logging

from dotenv import load_dotenv
from groq import Groq, RateLimitError, APIConnectionError, APIStatusError
from json_repair import repair_json

load_dotenv()

logger = logging.getLogger(__name__)

client = Groq(api_key=os.getenv("GROQ_API_KEY"))

MODEL = "llama-3.3-70b-versatile"
MAX_RETRIES = 3
BASE_BACKOFF_SECONDS = 2  # exponential: 2s, 4s, 8s

SYSTEM_PROMPT = """You are an expert ATS Resume Parser.

Extract and return ONLY valid JSON matching this schema exactly:

{
    "name": "",
    "email": "",
    "phone": "",
    "linkedin": "",
    "github": "",
    "skills": [],
    "education": [],
    "certifications": [],
    "projects": [],
    "work_experience": [
        {
            "company": "",
            "role": "",
            "start_date": "",
            "end_date": "",
            "currently_working": false,
            "is_technical_role": true
        }
    ],
    "internships": [
        {
            "company": "",
            "role": "",
            "start_date": "",
            "end_date": "",
            "currently_working": false,
            "is_technical_role": true
        }
    ]
}

Rules:

1. SKILLS EXTRACTION -- be exhaustive, do not summarize or truncate:
   - Extract every technical skill mentioned anywhere in the resume: in a
     dedicated "Skills" section, AND mentioned inline within project
     descriptions, work experience bullet points, or coursework.
   - Include: programming languages, frameworks/libraries, databases, cloud
     platforms, tools, software, and named methodologies (e.g. "Agile",
     "CI/CD").
   - Do not deduplicate-by-merging different technologies (e.g. "scikit-learn"
     and "TensorFlow" are both kept, never merged into "ML libraries").
   - Do not omit a skill because it seems minor or was only mentioned once.

2. WORK EXPERIENCE vs INTERNSHIPS -- these are SEPARATE arrays, never mixed:
   - Put a role in "internships" if the role title contains "intern" /
     "internship" / "trainee", OR if the surrounding text explicitly
     describes it as an internship, OR if it's clearly a fixed-term
     student placement (typically 1-6 months, tied to an academic program).
   - Put a role in "work_experience" ONLY if it is genuine full-time,
     part-time, or contract employment that is NOT an internship.
   - Every other field (company, role, dates, is_technical_role) follows
     the same rules for both arrays.

3. IS_TECHNICAL_ROLE -- scope is broad IT/tech, and ONLY IT/tech:
   - COUNTS as technical: software development/engineering, data science,
     machine learning/AI, data analysis, cloud engineering, DevOps/SRE,
     QA/test automation, IT support/helpdesk, system administration,
     cybersecurity/infosec, database administration, IT business analysis,
     technical product management, and any role primarily built around
     writing code, working with data/databases, or operating IT
     infrastructure.
   - Does NOT count as technical: civil/mechanical/electrical engineering
     site or design work (even if it uses CAD or Excel), sales, marketing,
     HR, finance/accounting, general operations, or any role where
     software is merely an incidental tool rather than the core function.
   - When uncertain, judge based on the actual day-to-day work described,
     not just the job title.

4. Dates MUST be normalized to "YYYY-MM" format (e.g. "2022-06"). If only
   a year is known, use "YYYY". If currently employed/active, set
   currently_working=true and leave end_date as null.
5. Use null for any field you cannot find -- never invent data.
6. Return JSON only. No markdown, no code fences, no explanations.
"""


class ResumeParsingError(Exception):
    """Raised when the resume cannot be parsed into valid JSON after all fallbacks."""
    pass


def _extract_json_text(response) -> str:
    content = response.choices[0].message.content
    # Defensive strip even with JSON mode -- some models still wrap in fences occasionally.
    return content.replace("```json", "").replace("```", "").strip()


def _call_groq(resume_text: str):
    """Single API call with JSON mode enabled."""
    return client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": resume_text},
        ],
        temperature=0,
        max_tokens=4096,
        response_format={"type": "json_object"},  # JSON mode: model is constrained to emit valid JSON
    )


def parse_resume(resume_text: str) -> dict:
    """
    Parse resume text into structured JSON.

    Defense in depth:
      1. Groq JSON mode -- constrains the model's output grammar, eliminating
         most malformed-JSON failures at the source.
      2. Retry with exponential backoff -- handles transient rate limits /
         connection errors (common at scale, this is the main "production"
         concern at higher volume).
      3. json-repair fallback -- last resort if the model still returns
         near-valid-but-broken JSON (truncated, trailing commas, etc).

    Returns a dict. On unrecoverable failure, returns a dict with an
    "error" key rather than raising, so the API layer can decide how
    to respond (matches the original contract callers expect).
    """
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = _call_groq(resume_text)
            raw = _extract_json_text(response)

            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(
                    "Model output wasn't clean JSON despite JSON mode; "
                    "attempting repair (attempt %d)", attempt
                )
                repaired = repair_json(raw)
                parsed = json.loads(repaired)
                logger.info("json-repair fallback succeeded")
                return parsed

        except RateLimitError as e:
            last_error = e
            if attempt < MAX_RETRIES:
                wait = BASE_BACKOFF_SECONDS * (2 ** (attempt - 1))
                logger.warning(
                    "Rate limited by Groq (attempt %d/%d). Retrying in %ds",
                    attempt, MAX_RETRIES, wait
                )
                time.sleep(wait)
                continue
            return {"error": "Rate limit exceeded after retries", "detail": str(e)}

        except APIConnectionError as e:
            last_error = e
            if attempt < MAX_RETRIES:
                wait = BASE_BACKOFF_SECONDS * (2 ** (attempt - 1))
                logger.warning(
                    "Groq connection error (attempt %d/%d). Retrying in %ds",
                    attempt, MAX_RETRIES, wait
                )
                time.sleep(wait)
                continue
            return {"error": "Could not reach Groq API after retries", "detail": str(e)}

        except APIStatusError as e:
            # Non-retryable API error (bad request, auth failure, etc.)
            logger.error("Groq API error: %s", e)
            return {"error": "Groq API returned an error", "detail": str(e)}

        except json.JSONDecodeError as e:
            last_error = e
            logger.error("json-repair also failed to produce valid JSON: %s", e)
            return {
                "error": "Model output could not be parsed as JSON even after repair",
                "detail": str(e),
                "raw_response": raw if "raw" in dir() else None,
            }

        except Exception as e:
            logger.exception("Unexpected error during resume parsing")
            return {"error": "Unexpected parsing failure", "detail": str(e)}

    return {"error": "Failed after all retries", "detail": str(last_error)}
