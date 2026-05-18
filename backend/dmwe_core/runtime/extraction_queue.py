from __future__ import annotations

import json
import logging
import os
import boto3

from dmwe_core.utils.database import update_job_progress

logger = logging.getLogger(__name__)

sqs_client = boto3.client("sqs")
EXTRACTION_QUEUE_URL = os.environ.get("EXTRACTION_QUEUE_URL")


def is_running_in_lambda() -> bool:
    """
    実行環境が AWS Lambda かどうかを推定する。
    - ローカル uvicorn: 通常これらの環境変数は設定されない
    - Lambda: AWS_LAMBDA_FUNCTION_NAME / AWS_EXECUTION_ENV 等が設定される
    """
    aws_exec_env = os.environ.get("AWS_EXECUTION_ENV", "")
    if aws_exec_env.startswith("AWS_Lambda_"):
        return True

    fn = os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    task_root = os.environ.get("LAMBDA_TASK_ROOT", "")
    if fn and task_root.startswith("/var/task"):
        return True

    return False


def invoke_worker_locally(job_id: str, uploads_payload: list[dict]) -> None:
    """
    ローカル開発向けフォールバック:
    SQS が未設定の場合に、同一プロセス内で extraction_worker を同期的に実行する。
    """
    from dmwe_core.workers.pdf_extraction_worker import extraction_worker

    try:
        extraction_worker(
            {
                "Records": [
                    {
                        "body": json.dumps(
                            {
                                "job_id": job_id,
                                "uploads": uploads_payload,
                            }
                        )
                    }
                ]
            },
            None,
        )
    except Exception as e:
        logger.error("Local worker execution failed for job %s: %s", job_id, str(e))
        try:
            update_job_progress(job_id, status="failed")
        except Exception:
            pass


__all__ = (
    "EXTRACTION_QUEUE_URL",
    "invoke_worker_locally",
    "is_running_in_lambda",
    "sqs_client",
)
