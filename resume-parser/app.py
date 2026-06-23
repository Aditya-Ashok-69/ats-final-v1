import os
import json
import logging
import uuid

from fastapi import FastAPI, UploadFile, File, Request, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates

from extractors.pdf_extractor import extract_pdf_text, PDFExtractionError
from extractors.docx_extractor import extract_docx_text, DocxExtractionError
from extractors.file_validator import validate_file, FileValidationError

from services.resume_parser import parse_resume
from services.experience_calculator import calculate_experience

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="ATS Resume Parser")

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

templates = Jinja2Templates(directory="templates")


@app.get("/health")
async def health():
    """Liveness check — no Groq dependency, just confirms the service is up."""
    groq_key = os.getenv("GROQ_API_KEY")
    return {"status": "ok", "groq_key_configured": bool(groq_key and groq_key.strip())}


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.post("/extract")
async def extract_resume(file: UploadFile = File(...)):
    content = await file.read()

    # --- 1. Validate file (size + real content type, not just extension) ---
    try:
        file_type = validate_file(file.filename, content)
    except FileValidationError as e:
        raise HTTPException(status_code=400, detail=str(e))

    safe_name = f"{uuid.uuid4().hex}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, safe_name)

    try:
        with open(file_path, "wb") as f:
            f.write(content)

        # --- 2. Extract text ---
        try:
            if file_type == "pdf":
                text = extract_pdf_text(file_path)
            else:
                text = extract_docx_text(file_path)
        except (PDFExtractionError, DocxExtractionError) as e:
            raise HTTPException(status_code=422, detail=str(e))

        # --- 3. Parse resume via LLM ---
        parsed_resume = parse_resume(text)

        if "error" in parsed_resume:
            logger.error("Resume parsing failed: %s", parsed_resume)
            return JSONResponse(status_code=502, content=parsed_resume)

        # --- 4. Calculate experience (work_experience only, internships excluded) ---
        parsed_resume.setdefault("internships", [])
        experience = calculate_experience(parsed_resume.get("work_experience", []))
        parsed_resume.update(experience)

        # --- 5. Include raw extracted text so Node backend can use it for
        #         TF-IDF JD-similarity scoring without re-parsing the file. ---
        parsed_resume["raw_text"] = text

        logger.info("Successfully parsed resume: %s", file.filename)
        return parsed_resume

    finally:
        if os.path.exists(file_path):
            try:
                os.remove(file_path)
            except OSError as e:
                logger.warning("Could not delete temp file %s: %s", file_path, e)
