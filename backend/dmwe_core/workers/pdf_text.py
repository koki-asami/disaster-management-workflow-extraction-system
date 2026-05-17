from __future__ import annotations

import boto3

try:
    import fitz  # PyMuPDF
except ImportError:  # pragma: no cover - runtime guard
    fitz = None

from dmwe_core.utils.logger import get_logger
from dmwe_core.utils.s3_storage import BUCKET_NAME

logger = get_logger(__name__)
_s3 = boto3.client("s3")


def extract_text_by_page_from_s3(object_key: str) -> list[dict]:
    """
    S3 上の PDF からページごとのテキストを抽出する。

    戻り値: [{ "page_index": int, "text": str }, ...]
    """
    if fitz is None:
        logger.error("PyMuPDF (fitz) is not available in this runtime")
        raise RuntimeError("PyMuPDF (fitz) is not available in this runtime")

    logger.info("Downloading PDF from S3 for extraction: %s", object_key)
    resp = _s3.get_object(Bucket=BUCKET_NAME, Key=object_key)
    pdf_bytes = resp["Body"].read()

    pages: list[dict] = []
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        for i, page in enumerate(doc):
            text = page.get_text()
            pages.append({"page_index": i, "text": text})
        doc.close()
    except Exception as e:
        logger.error("Failed to extract text from PDF %s: %s", object_key, str(e))
        raise

    logger.info("Extracted text from %d pages for %s", len(pages), object_key)
    return pages
