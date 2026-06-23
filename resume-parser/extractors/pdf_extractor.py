import fitz  # PyMuPDF


class PDFExtractionError(Exception):
    """Raised when a PDF cannot be opened or contains no extractable text."""
    pass


def extract_pdf_text(file_path: str) -> str:
    """
    Extract text from a PDF file.

    Raises:
        PDFExtractionError: if the file is corrupt, encrypted, or has no text.
    """
    try:
        pdf = fitz.open(file_path)
    except Exception as e:
        raise PDFExtractionError(f"Could not open PDF: {e}")

    try:
        if pdf.is_encrypted:
            raise PDFExtractionError("PDF is password-protected")

        text_parts = [page.get_text() for page in pdf]
        text = "\n".join(text_parts).strip()

        if not text:
            # Common case: scanned/image-only resume with no OCR layer.
            raise PDFExtractionError(
                "No extractable text found (likely a scanned/image-only PDF)"
            )

        return text

    finally:
        pdf.close()
