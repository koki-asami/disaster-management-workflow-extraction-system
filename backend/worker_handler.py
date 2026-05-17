"""Lambda entrypoint for SQS-triggered PDF extraction (set handler to worker_handler.handler)."""

from dmwe_core.workers.pdf_extraction_worker import extraction_worker


def handler(event, context):
    return extraction_worker(event, context)
