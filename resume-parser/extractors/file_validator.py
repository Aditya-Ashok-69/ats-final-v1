"""
File validation using magic-byte sniffing.

Why not python-magic: it wraps libmagic, a C library that's installed
separately from pip and is unreliable on Windows. For two file types
(PDF, DOCX) checking the first few bytes ourselves is more portable
and has zero extra system dependencies -- useful since your team will
likely run this on a mix of Windows/Linux machines.
"""

MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB -- generous for a resume

PDF_MAGIC = b"%PDF-"
# DOCX (and any modern Office file) is a ZIP container -- starts with PK\x03\x04
DOCX_MAGIC = b"PK\x03\x04"


class FileValidationError(Exception):
    """Raised when an uploaded file fails validation."""
    pass


def validate_file(filename: str, content: bytes) -> str:
    """
    Validate file size and actual content type (not just extension).

    Returns:
        "pdf" or "docx" depending on detected type.

    Raises:
        FileValidationError: with a user-facing reason.
    """
    if not content:
        raise FileValidationError("Uploaded file is empty")

    if len(content) > MAX_FILE_SIZE_BYTES:
        size_mb = len(content) / (1024 * 1024)
        raise FileValidationError(
            f"File too large ({size_mb:.1f}MB). Max allowed is "
            f"{MAX_FILE_SIZE_BYTES / (1024 * 1024):.0f}MB"
        )

    lower_name = filename.lower()

    if lower_name.endswith(".pdf"):
        if not content.startswith(PDF_MAGIC):
            raise FileValidationError(
                "File has a .pdf extension but isn't a real PDF "
                "(content doesn't match PDF signature)"
            )
        return "pdf"

    elif lower_name.endswith(".docx"):
        if not content.startswith(DOCX_MAGIC):
            raise FileValidationError(
                "File has a .docx extension but isn't a real DOCX "
                "(content doesn't match the expected zip-based format)"
            )
        return "docx"

    else:
        raise FileValidationError(
            "Unsupported file type. Only .pdf and .docx are accepted"
        )
