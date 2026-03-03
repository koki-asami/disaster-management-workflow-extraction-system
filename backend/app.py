from chalice import Chalice, Response, CORSConfig
import openai
import os
import base64
import traceback
import io
import json
import time
import uuid
from dotenv import load_dotenv
from pathlib import Path

import boto3
import fitz  # PyMuPDF
import threading

from utils.database import (
    save_flowchart,
    get_flowchart,
    list_flowcharts,
    delete_flowchart,
    create_upload_record,
    list_uploads,
    mark_upload_complete,
    get_upload,
    delete_upload_record,
    get_jobs_table,
    create_job,
    update_job_progress,
    save_job_result,
    get_job,
)
from utils.s3_storage import create_presigned_upload_url, delete_object, BUCKET_NAME
from utils.logger import get_logger


# Load environment variables from .env file if it exists
load_dotenv()

# ロガーの初期化
logger = get_logger(__name__)

app = Chalice(__name__)
app.debug = True

# CORS設定
cors_config = CORSConfig(
    allow_origin='*',
    allow_headers=['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', '*'],
    max_age=600,
    expose_headers=['X-Custom-Header'],
    allow_credentials=True,
)

# OpenAI APIキーとクライアント設定
openai.api_key = os.environ.get('OPENAI_API_KEY')
client = openai.OpenAI()
if not openai.api_key:
    logger.error("OPENAI_API_KEY environment variable is not set")

# モデル設定（環境変数で上書き可能）
TASK_EXTRACTION_MODEL = os.environ.get("TASK_EXTRACTION_MODEL", "gpt-5.2")
DEPENDENCY_EXTRACTION_MODEL = os.environ.get("DEPENDENCY_EXTRACTION_MODEL", "gpt-5.2")
CHAT_MODEL = os.environ.get("CHAT_MODEL", "gpt-5.2")

# SQS / S3 クライアントとキュー設定
sqs_client = boto3.client("sqs")
s3_client = boto3.client("s3")
EXTRACTION_QUEUE_URL = os.environ.get("EXTRACTION_QUEUE_URL")


def _is_running_in_lambda() -> bool:
    """
    実行環境が AWS Lambda かどうかを推定する。
    - chalice local: 通常これらの環境変数は設定されない
    - Lambda: AWS_LAMBDA_FUNCTION_NAME / AWS_EXECUTION_ENV 等が設定される
    """
    aws_exec_env = os.environ.get("AWS_EXECUTION_ENV", "")
    if aws_exec_env.startswith("AWS_Lambda_"):
        return True

    fn = os.environ.get("AWS_LAMBDA_FUNCTION_NAME")
    task_root = os.environ.get("LAMBDA_TASK_ROOT", "")
    # Lambda では通常 /var/task を指す。ローカル環境で誤って変数が入っていても
    # /var/task にならない限り Lambda とみなさない。
    if fn and task_root.startswith("/var/task"):
        return True

    return False


def _invoke_worker_locally(job_id: str, uploads_payload: list[dict]) -> None:
    """
    ローカル開発向けフォールバック:
    SQS が未設定の場合に、同一プロセス内で extraction_worker をバックグラウンド実行する。
    """
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
            context=None,
        )
    except Exception as e:
        logger.error("Local worker execution failed for job %s: %s", job_id, str(e))
        try:
            update_job_progress(job_id, status="failed")
        except Exception:
            # 最後の手段として握りつぶす（ローカルフォールバックのため）
            pass

# proxies設定を削除
# 以前のバージョンのOpenAIライブラリでは必要なかった可能性があります


MERMAID_PROMPT_TEMPLATE = """
    あなたはの役割は、抽出された詳細タスクと詳細タスク間の依存関係もとに、視覚的に整理することです。
    次の作業手順を踏まえ、結果を指定された形式でmermaidのフローチャートとして出力してください。

    ### 作業時の注意点
    -  抽出された詳細タスクと詳細タスク間の依存関係もとに、mermaidのフローチャートを作成してください
      - 災害対応項目名はsubgraphで表現してください
      - taskは災害対応項目名のsubgraph内にsubgraphとして記載してください
      - 依存関係はdependenciesに記載のあるtaskのsubgraphから矢印を出してください
      - 担当部署はtaskのsubgraphの下にnodeとして記載してください
      - 具体的な説明もtaskのsubgraphの下にnodeとして記載してください

    ### Mermaidフローチャート作成時の注意事項
    下記は必ず守るようにしてください。守れなければ再度実行することになるので疲れますよ。
    - mermaidの形式は「flowchart-elk TD」を必ず使用してください
    - 特殊文字「・」がある場合は、必要に応じてスラッシュ「/」に置き換えてください
    - 全角文字の特殊文字は使用しないでください
    - フローチャートを作成する際は、タスクの階層を明確にするためにsectionやsubgraphを活用してください
    - 各sectionをさらに細分化し、セクション名をタスク名とし、ノード内にタスクの具体的な説明を記載してください

    ### 抽出されたタスク
    下記の抽出された情報をもとにmermaidのフローチャートを作成してください。
"""

MERMAID_UPDATE_PROMPT_TEMPLATE = """
    あなたはの役割は、ユーザーとのチャットを通じて、フローチャートを更新することです。
    次の作業手順を踏まえ、結果を指定された形式でmermaidのフローチャートとして出力してください。

    ### 作業時の注意点
    -  抽出された詳細タスクと詳細タスク間の依存関係もとに、mermaidのフローチャートを作成してください
      - 災害対応項目名はsubgraphで表現してください
      - taskは災害対応項目名のsubgraph内にsubgraphとして記載してください
      - 依存関係はdependenciesに記載のあるtaskのsubgraphから矢印を出してください
      - 担当部署はtaskのsubgraphの下にnodeとして記載してください
      - 具体的な説明もtaskのsubgraphの下にnodeとして記載してください

    ### Mermaidフローチャート作成時の注意事項
    下記は必ず守るようにしてください。守れなければ再度実行することになるので疲れますよ。
    - mermaidの形式は「flowchart-elk TD」を必ず使用してください
    - 特殊文字「・」がある場合は、必要に応じてスラッシュ「/」に置き換えてください
    - 全角文字の特殊文字は使用しないでください
    - フローチャートを作成する際は、タスクの階層を明確にするためにsectionやsubgraphを活用してください
    - 各sectionをさらに細分化し、セクション名をタスク名とし、ノード内にタスクの具体的な説明を記載してください

    ### 作成済のmermaidフローチャート
    下記の抽出された情報をもとにmermaidのフローチャートを更新してください。
"""


def _extract_text_by_page_from_s3(object_key: str) -> list[dict]:
    """
    S3 上の PDF からページごとのテキストを抽出するヘルパー。

    戻り値: [{ "page_index": int, "text": str }, ...]
    """
    logger.info("Downloading PDF from S3 for extraction: %s", object_key)
    resp = s3_client.get_object(Bucket=BUCKET_NAME, Key=object_key)
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


@app.route("/uploads/presign", methods=["POST"], cors=cors_config)
def presign_upload():
    """Create a presigned URL and an upload record for a PDF."""
    body = app.current_request.json_body or {}
    filename = body.get("filename")
    content_type = body.get("content_type", "application/pdf")

    if not filename:
        return Response(
            body={"error": "filename is required"},
            status_code=400,
        )

    # S3 object key: uploads/<uuid>/<original-filename>
    upload_id = str(uuid.uuid4())
    object_key = f"uploads/{upload_id}/{filename}"

    try:
        upload_url = create_presigned_upload_url(
            object_key=object_key,
            content_type=content_type,
        )
        # Create DynamoDB record with pending status
        record = create_upload_record(
            filename=filename,
            object_key=object_key,
            status="pending",
            size_bytes=None,
        )
        # Overwrite auto-generated UUID with the one we decided for key consistency
        # (record['upload_id'] may differ from upload_id)
        # To avoid mismatch, we prefer to use record['upload_id'] as source of truth.

        return {
            "upload_id": record["upload_id"],
            "object_key": object_key,
            "upload_url": upload_url,
        }
    except Exception as e:
        logger.error("Error creating presigned upload: %s", str(e))
        return Response(
            body={"error": f"Failed to create presigned upload: {str(e)}"},
            status_code=500,
        )


@app.route("/uploads/complete", methods=["POST"], cors=cors_config)
def complete_upload():
    """Mark an upload as completed (after client PUT to S3)."""
    body = app.current_request.json_body or {}
    upload_id = body.get("upload_id")
    size_bytes = body.get("size_bytes")

    if not upload_id:
        return Response(
            body={"error": "upload_id is required"},
            status_code=400,
        )

    item = mark_upload_complete(upload_id=upload_id, size_bytes=size_bytes)
    if not item:
        return Response(
            body={"error": "Upload not found or failed to update"},
            status_code=404,
        )

    return {"upload": item}


@app.route("/uploads", methods=["GET"], cors=cors_config)
def list_uploads_endpoint():
    """List all uploaded PDFs (for selection in the UI)."""
    try:
        uploads = list_uploads()
        # ソート: 新しいものが先
        uploads = sorted(uploads, key=lambda x: x.get("created_at", ""), reverse=True)
        return {"uploads": uploads}
    except Exception as e:
        logger.error("Error listing uploads: %s", str(e))
        return Response(
            body={"error": f"Error listing uploads: {str(e)}"},
            status_code=500,
        )


@app.route("/uploads/{upload_id}", methods=["DELETE"], cors=cors_config)
def delete_upload_endpoint(upload_id):
    """Delete an upload record and its S3 object."""
    try:
        item = get_upload(upload_id)
        if not item:
            return Response(
                body={"error": "Upload not found"},
                status_code=404,
            )

        object_key = item.get("object_key")
        if object_key:
            try:
                delete_object(object_key)
            except Exception:
                # S3削除失敗はログのみ残し、レコード削除は続行
                logger.warning(
                    "Failed to delete S3 object for upload %s (key=%s)",
                    upload_id,
                    object_key,
                )

        ok = delete_upload_record(upload_id)
        if not ok:
            return Response(
                body={"error": "Failed to delete upload record"},
                status_code=500,
            )

        return {"message": "Upload deleted", "upload_id": upload_id}
    except Exception as e:
        logger.error("Error deleting upload %s: %s", upload_id, str(e))
        return Response(
            body={"error": f"Error deleting upload: {str(e)}"},
            status_code=500,
        )


@app.route("/extractions", methods=["POST"], cors=cors_config)
def create_extraction_job_endpoint():
    """
    アップロード済みPDF群から抽出ジョブを作成し、SQS に投入する。

    期待するリクエストボディ:
    {
      "upload_ids": ["...", "..."]
    }
    """
    body = app.current_request.json_body or {}
    upload_ids = body.get("upload_ids") or []

    if not isinstance(upload_ids, list) or not upload_ids:
        return Response(
            body={"error": "upload_ids must be a non-empty array"},
            status_code=400,
        )

    # 対象アップロードのメタ情報を取得
    uploads_payload: list[dict] = []
    for upload_id in upload_ids:
        item = get_upload(upload_id)
        if not item:
            return Response(
                body={"error": f"Upload not found: {upload_id}"},
                status_code=404,
            )
        uploads_payload.append(
            {
                "upload_id": item["upload_id"],
                "object_key": item["object_key"],
                "filename": item.get("filename") or item["object_key"],
            }
        )

    # ジョブを作成
    job_item = create_job(uploads=uploads_payload, status="queued")
    job_id = job_item["job_id"]
    update_job_progress(job_id, status="queued", phase="queued", detail="ジョブを作成しました")

    logger.info(
        "Runtime detection for /extractions: is_lambda=%s, AWS_EXECUTION_ENV=%s, AWS_LAMBDA_FUNCTION_NAME=%s, LAMBDA_TASK_ROOT=%s",
        _is_running_in_lambda(),
        os.environ.get("AWS_EXECUTION_ENV"),
        os.environ.get("AWS_LAMBDA_FUNCTION_NAME"),
        os.environ.get("LAMBDA_TASK_ROOT"),
    )

    # 実行環境を自動判定:
    # - ローカル(chalice local)では SQS を使わずにバックグラウンド実行
    # - AWS Lambda では SQS に enqueue（未設定なら設定不備としてエラー）
    if not _is_running_in_lambda():
        logger.info("Running extraction worker locally for job %s", job_id)
        t = threading.Thread(
            target=_invoke_worker_locally,
            args=(job_id, uploads_payload),
            daemon=True,
        )
        t.start()
        return Response(
            body={
                "job_id": job_id,
                "status": "processing",
                "mode": "local",
            },
            status_code=202,
        )

    if not EXTRACTION_QUEUE_URL:
        logger.error("EXTRACTION_QUEUE_URL is not configured (Lambda runtime)")
        return Response(
            body={
                "error": "EXTRACTION_QUEUE_URL is not configured. "
                "AWS 上で SQS キューを作成し、環境変数に設定してください。",
                "job_id": job_id,
            },
            status_code=500,
        )

    try:
        sqs_client.send_message(
            QueueUrl=EXTRACTION_QUEUE_URL,
            MessageBody=json.dumps(
                {
                    "job_id": job_id,
                    "uploads": uploads_payload,
                }
            ),
        )
    except Exception as e:
        logger.error("Failed to enqueue extraction job %s: %s", job_id, str(e))
        return Response(
            body={"error": f"Failed to enqueue extraction job: {str(e)}"},
            status_code=500,
        )

    return {
        "job_id": job_id,
        "status": "queued",
        "mode": "sqs",
    }


@app.route("/extractions/{job_id}", methods=["GET"], cors=cors_config)
def get_extraction_job_endpoint(job_id: str):
    """
    抽出ジョブの状態および、完了していれば結果を返す。
    """
    job = get_job(job_id)
    if not job:
        return Response(
            body={"error": "Job not found"},
            status_code=404,
        )

    status = job.get("status", "unknown")
    # DynamoDB returns Decimal for numbers; ensure int for JSON
    _num = lambda v: int(v) if v is not None else 0
    progress = _num(job.get("progress")) if job.get("progress") is not None else 0
    processed_pages = _num(job.get("processed_pages"))
    total_pages = _num(job.get("total_pages"))
    summary = job.get("summary")
    phase = job.get("phase")
    detail = job.get("detail")
    phase_current = int(job["phase_current"]) if job.get("phase_current") is not None else None
    phase_total = int(job["phase_total"]) if job.get("phase_total") is not None else None
    phase_unit = job.get("phase_unit")
    result_s3_key = job.get("result_s3_key")

    response_body: dict = {
        "job_id": job_id,
        "status": status,
        "progress": progress,
        "processed_pages": processed_pages,
        "total_pages": total_pages,
        "summary": summary,
        "phase": phase,
        "detail": detail,
        "phase_current": phase_current,
        "phase_total": phase_total,
        "phase_unit": phase_unit,
        "result": None,
    }

    # 完了していて結果キーがある場合は、S3 から結果JSONを読み込む
    if status == "completed" and result_s3_key:
        try:
            obj = s3_client.get_object(Bucket=BUCKET_NAME, Key=result_s3_key)
            content = obj["Body"].read().decode("utf-8")
            result_json = json.loads(content)
            response_body["result"] = result_json
        except Exception as e:
            logger.error(
                "Failed to load extraction result for job %s from s3://%s/%s: %s",
                job_id,
                BUCKET_NAME,
                result_s3_key,
                str(e),
            )

    return response_body


def _parse_json_response(raw_text: str, expected_root_key: str | None = None) -> dict:
    """
    LLMからの応答文字列からJSONオブジェクトを安全に取り出すヘルパー。
    - コードフェンスや説明文が混ざっている場合も、最初の'{'から最後の'}'までを抽出してjson.loadsする。
    - expected_root_key が指定されている場合、そのキーをトップレベルに含むことを簡易チェックする。
    """
    if not isinstance(raw_text, str):
        raise ValueError("Response content is not a string")

    raw_text = raw_text.strip()

    # まず素直にパースを試みる
    try:
        data = json.loads(raw_text)
    except Exception:
        # 最初の'{'〜最後の'}' だけを抜き出して再トライ
        start = raw_text.find("{")
        end = raw_text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        candidate = raw_text[start : end + 1]
        data = json.loads(candidate)

    if expected_root_key is not None and expected_root_key not in data:
        raise ValueError(f"Expected root key '{expected_root_key}' not found in JSON response")
    return data


@app.lambda_function(name="extraction_worker")
def extraction_worker(event, context):
    """
    SQS からトリガーされる非同期ワーカー。

    期待するメッセージボディ:
        {
          "job_id": "<JOB_ID>",
          "uploads": [
            {
              "upload_id": "...",
              "object_key": "uploads/....pdf",
              "filename": "xxx.pdf"
            },
            ...
          ]
        }
    """
    logger.info("extraction_worker invoked with event: %s", json.dumps(event))

    # SQS イベントの場合 Records 配列内の body にペイロードが入る
    records = event.get("Records", [])
    if not records:
        logger.warning("No Records in event for extraction_worker")
        return {"status": "no_records"}

    for record in records:
        try:
            body_str = record.get("body", "")
            logger.info("Processing SQS message body: %s", body_str)
            body = json.loads(body_str)
        except Exception as e:
            logger.error("Failed to parse SQS message body: %s", str(e))
            continue

        job_id = body.get("job_id")
        uploads = body.get("uploads") or []

        if not job_id or not uploads:
            logger.warning("Invalid message: missing job_id or uploads")
            continue

        # ページ総数の計算とテキスト抽出
        all_docs: list[dict] = []  # [{upload_id, filename, object_key, pages: [{page_index,text}, ...]}, ...]
        total_pages = 0

        for item in uploads:
            object_key = item.get("object_key")
            upload_id = item.get("upload_id")
            filename = item.get("filename") or object_key

            if not object_key:
                logger.warning("Upload item missing object_key: %s", item)
                continue

            pages = _extract_text_by_page_from_s3(object_key)
            total_pages += len(pages)
            all_docs.append(
                {
                    "upload_id": upload_id,
                    "filename": filename,
                    "object_key": object_key,
                    "pages": pages,
                }
            )

        if total_pages == 0:
            logger.warning("No pages found for job %s", job_id)
            update_job_progress(job_id, processed_pages=0, total_pages=0, status="failed")
            continue

        # 進捗配分（全体 0-100 のうち、各フェーズに割り当て）
        # - テキスト抽出: 0-60（ページ進捗に比例）
        # - タスク抽出: 60-80
        # - 依存関係抽出: 80-95
        # - 整形/保存: 95-100
        processed_pages = 0
        update_job_progress(
            job_id,
            processed_pages=0,
            total_pages=total_pages,
            status="processing",
            phase="text_extraction",
            detail="PDFのテキスト抽出中",
            progress=0,
            phase_unit="pages",
            phase_current=0,
            phase_total=total_pages,
        )

        # ページごとのメタ情報（全文テキスト）を LLM に渡すために組み立てる
        doc_summaries: list[dict] = []
        for doc in all_docs:
            pages_meta = []
            for page in doc["pages"]:
                processed_pages += 1
                text = page["text"] or ""
                pages_meta.append(
                    {
                        "page_index": page["page_index"],
                        "text": text,
                    }
                )
                # 進捗を各ページごとに更新（ジョブ全体 0-60% にマッピング）
                scaled_progress = int((processed_pages / total_pages) * 60) if total_pages else 0
                update_job_progress(
                    job_id,
                    processed_pages=processed_pages,
                    total_pages=total_pages,
                    status="processing",
                    phase="text_extraction",
                    progress=scaled_progress,
                    phase_unit="pages",
                    phase_current=processed_pages,
                    phase_total=total_pages,
                )

            doc_summaries.append(
                {
                    "filename": doc["filename"],
                    "object_key": doc["object_key"],
                    "pages": pages_meta,
                }
            )

        file_names_str = ", ".join(d["filename"] for d in all_docs)
        logger.info("Starting LLM-based extraction for job %s", job_id)

        # ---- タスク抽出（ページメタ情報を利用）----
        # 分母: タスク数（1バッチ抽出 = 0/1 → 完了時 N/N）
        try:
            update_job_progress(
                job_id,
                status="processing",
                phase="task_extraction",
                detail="タスク抽出中",
                # テキスト抽出完了後の 60% から開始
                progress=60,
                phase_unit="tasks",
                phase_current=0,
                phase_total=1,
            )
            task_system_prompt = f"""
あなたは防災計画PDFから災害対応タスクを抽出する専門家です。
対象となるPDFファイル: {file_names_str}

以下に、PDFごと・ページごとの全文テキストが JSON で与えられます。
この情報をもとに、災害時に必要な対応タスクを漏れなく構造化して抽出してください。

### コンテキストJSON
{json.dumps({"documents": doc_summaries}, ensure_ascii=False)}

### 目的
地域防災計画等から、災害時に必要な具体的な対応タスクをできる限り漏れなく抽出し、
後続処理でグラフ化しやすいように構造化されたJSONとして出力します。

### 出力フォーマット
次の構造を持つJSONオブジェクト**のみ**を返してください（説明文やコードフェンスは一切出力しないこと）:

- ルートオブジェクトに "tasks" というキーを1つだけ持つ
- "tasks" は配列で、各要素は以下のプロパティを持つ:
  - "id": 例 "t001" のような一意なID（以降の依存関係で参照できるようにする）
  - "name": タスク名（短いラベル）
  - "department": 主担当部署名（複数部署の場合はカンマ区切りで列挙してよい）
  - "description": タスクの具体的な内容
  - "category": 章・節・セクション名など、そのタスクが属する大分類
  - "source_pdf": 主に参照したPDFファイル名
  - "page_range": "3-4" のように主に関連するページ範囲（単一ページなら "3"）
  - "context_snippets": 依存関係抽出に役立つ原文抜粋の配列（最大3件程度）

### 抽出時の注意点
- 災害応急対策に関する章・節を中心に、時間をかけて網羅的にタスクを抽出してください。
- 類似タスクが複数PDF・複数ページに跨る場合は、1つのタスクに集約し、description や context_snippets に統合してよいです。
- JSON以外（解説文、日本語の前置き、コードフェンス ``` など）は一切出力しないでください。
"""

            task_user_message = "防災計画PDF群から災害対応タスクを抽出し、指定のJSONフォーマットで返してください。"

            task_response = client.chat.completions.create(
                model=TASK_EXTRACTION_MODEL,
                messages=[
                    {"role": "system", "content": task_system_prompt},
                    {
                        "role": "user",
                        "content": task_user_message,
                    },
                ],
            )

            task_content = task_response.choices[0].message.content
            logger.info("Raw task extraction response (job %s): %s", job_id, task_content)
            task_json = _parse_json_response(task_content, expected_root_key="tasks")
            raw_tasks = task_json.get("tasks", [])

            # 類似タスクの集約（name と department でグルーピング）
            deduped_tasks: list[dict] = []
            index_by_key: dict[tuple[str, str], int] = {}

            for t in raw_tasks:
                name = (t.get("name") or "").strip()
                department = (t.get("department") or "").strip()

                if not name:
                    # 名前がないタスクはそのまま追加
                    ctx = t.get("context_snippets") or []
                    if isinstance(ctx, str):
                        ctx = [ctx]
                    t["context_snippets"] = ctx
                    deduped_tasks.append(t)
                    continue

                key = (name.lower(), department.lower())
                if key not in index_by_key:
                    ctx = t.get("context_snippets") or []
                    if isinstance(ctx, str):
                        ctx = [ctx]
                    t["context_snippets"] = ctx
                    index_by_key[key] = len(deduped_tasks)
                    deduped_tasks.append(t)
                else:
                    existing = deduped_tasks[index_by_key[key]]

                    # description を統合
                    existing_desc = existing.get("description")
                    new_desc = t.get("description")
                    if new_desc and new_desc != existing_desc:
                        if existing_desc:
                            if new_desc not in existing_desc:
                                existing["description"] = f"{existing_desc} / {new_desc}"
                        else:
                            existing["description"] = new_desc

                    # context_snippets をマージ（重複除去・最大5件）
                    ctx1 = existing.get("context_snippets") or []
                    if isinstance(ctx1, str):
                        ctx1 = [ctx1]
                    ctx2 = t.get("context_snippets") or []
                    if isinstance(ctx2, str):
                        ctx2 = [ctx2]
                    merged_ctx: list[str] = []
                    for s in ctx1 + ctx2:
                        if s and s not in merged_ctx:
                            merged_ctx.append(s)
                    existing["context_snippets"] = merged_ctx[:5]

            tasks = deduped_tasks
            num_tasks = len(tasks)
            update_job_progress(
                job_id,
                status="processing",
                phase="task_extraction",
                detail=f"タスク抽出完了（{num_tasks}件）",
                # タスク抽出完了時点で 80% まで進める
                progress=80,
                phase_unit="tasks",
                phase_current=num_tasks,
                phase_total=num_tasks,
            )
        except Exception as e:
            logger.error("Task extraction failed for job %s: %s", job_id, str(e))
            update_job_progress(job_id, processed_pages=processed_pages, total_pages=total_pages, status="failed")
            continue

        # ---- 依存関係抽出 ----
        try:
            update_job_progress(
                job_id,
                status="processing",
                phase="dependency_extraction",
                detail="依存関係抽出中",
                # タスク抽出完了後の 80% から開始
                progress=80,
                phase_unit="tasks",
                phase_current=0,
                phase_total=len(tasks),
            )
            logger.info("Calling OpenAI for dependency extraction (job %s)", job_id)
            tasks_json_text = json.dumps({"tasks": tasks}, ensure_ascii=False)

            dependency_system_prompt = f"""
あなたは防災計画に基づくタスク間の依存関係を整理する専門家です。
対象となるPDFファイル: {file_names_str}

以下のタスク一覧(JSON)に対して、タスク同士の依存関係を抽出してください:
{tasks_json_text}

### 依存関係の定義
- あるタスクAを実施する前に完了しているべきタスクBが存在する場合、
  「B が A に先行する依存関係」とみなします。
- 別のカテゴリや別PDFに属するタスク同士の依存も必ず考慮してください。

### 出力フォーマット
次の構造を持つJSONオブジェクト**のみ**を返してください:
- ルートオブジェクトに "dependencies" というキーを1つだけ持つ
- "dependencies" は配列で、各要素は以下のプロパティを持つ:
  - "from": 先行タスクのID（上記tasks配列の "id" をそのまま使用）
  - "to": 後続タスクのID（同上）
  - "reason": その依存関係の理由や根拠となる記述の要約

### 注意
- JSON以外（説明文、日本語の前置き、コードフェンスなど）は一切出力しないでください。
"""

            dependency_user_message = "上記タスク間の依存関係を、指定のJSONフォーマットで抽出してください。"

            dependency_response = client.chat.completions.create(
                model=DEPENDENCY_EXTRACTION_MODEL,
                messages=[
                    {"role": "system", "content": dependency_system_prompt},
                    {
                        "role": "user",
                        "content": dependency_user_message,
                    },
                ],
            )

            dependency_content = dependency_response.choices[0].message.content
            logger.info(
                "Raw dependency extraction response (job %s): %s",
                job_id,
                dependency_content,
            )
            dependency_json = _parse_json_response(
                dependency_content, expected_root_key="dependencies"
            )
            dependencies = dependency_json.get("dependencies", [])
            update_job_progress(
                job_id,
                status="processing",
                phase="dependency_extraction",
                detail=f"依存関係抽出完了（{len(dependencies)}件）",
                # 依存関係抽出完了時点で 95% まで進める
                progress=95,
                phase_unit="tasks",
                phase_current=len(tasks),
                phase_total=len(tasks),
            )
        except Exception as e:
            logger.error("Dependency extraction failed for job %s: %s", job_id, str(e))
            update_job_progress(job_id, processed_pages=processed_pages, total_pages=total_pages, status="failed")
            continue

        # ---- 結果を S3 に保存し、ジョブを完了にする ----
        # 分母: タスク数（全タスク整形済み = N/N）
        update_job_progress(
            job_id,
            status="processing",
            phase="finalizing",
            detail="結果を保存・可視化用データに整形中",
            # 結果保存〜整形フェーズは 95-100%
            progress=97,
            phase_unit="tasks",
            phase_current=len(tasks),
            phase_total=len(tasks),
        )
        result_payload = {
            "job_id": job_id,
            "tasks": tasks,
            "dependencies": dependencies,
            "documents": [
                {
                    "filename": d["filename"],
                    "object_key": d["object_key"],
                }
                for d in all_docs
            ],
            "schema_version": "1.0",
        }

        result_key = f"extractions/{job_id}.json"
        try:
            s3_client.put_object(
                Bucket=BUCKET_NAME,
                Key=result_key,
                Body=json.dumps(result_payload, ensure_ascii=False),
                ContentType="application/json",
            )
            logger.info("Saved extraction result for job %s to s3://%s/%s", job_id, BUCKET_NAME, result_key)

            summary = {
                "task_count": len(tasks),
                "dependency_count": len(dependencies),
                "document_count": len(all_docs),
            }
            save_job_result(job_id, result_s3_key=result_key, summary=summary)
            update_job_progress(
                job_id,
                processed_pages=total_pages,
                total_pages=total_pages,
                status="completed",
                phase="completed",
                detail="完了",
                progress=100,
                phase_unit="tasks",
                phase_current=len(tasks),
                phase_total=len(tasks),
            )
        except Exception as e:
            logger.error("Failed to save result for job %s: %s", job_id, str(e))
            update_job_progress(job_id, processed_pages=processed_pages, total_pages=total_pages, status="failed")

    return {"status": "ok"}


@app.route('/analyze_pdf', methods=['POST'], cors=cors_config)
def analyze_pdf():
    logger.info("PDF analysis request received")
    request_body = app.current_request.json_body
    if not request_body:
        logger.warning("Invalid request: Request body is missing")
        return Response(
            body={'error': 'PDF data is required'},
            status_code=400
        )

    # ---- 入力正規化: 単一PDF or 複数PDF ----
    pdf_items: list[dict] = []

    # 新形式: files: [{ filename, pdf_data(base64) }, ...]
    files_payload = request_body.get("files")
    if isinstance(files_payload, list) and files_payload:
        for item in files_payload:
            if not isinstance(item, dict):
                continue
            base64_data = item.get("pdf_data")
            if not base64_data:
                continue
            filename = item.get("filename") or "地域防災計画.pdf"
            try:
                logger.info(f"Decoding PDF data for {filename}")
                pdf_bytes = base64.b64decode(base64_data)
                logger.info(f"Decoded {filename}, size: {len(pdf_bytes)} bytes")
            except Exception as e:
                logger.error(f"Failed to decode PDF data for {filename}: {str(e)}")
                return Response(
                    body={'error': f'Invalid PDF data for {filename}: {str(e)}'},
                    status_code=400
                )
            pdf_items.append({"filename": filename, "data": pdf_bytes})

    # 旧形式: 単一 pdf_data / filename
    elif "pdf_data" in request_body:
        filename = request_body.get("filename", "地域防災計画.pdf")
        try:
            logger.info(f"Decoding single PDF data for {filename}")
            pdf_bytes = base64.b64decode(request_body.get("pdf_data"))
            logger.info(f"Decoded {filename}, size: {len(pdf_bytes)} bytes")
        except Exception as e:
            logger.error(f"Failed to decode PDF data: {str(e)}")
            return Response(
                body={'error': f'Invalid PDF data: {str(e)}'},
                status_code=400
            )
        pdf_items.append({"filename": filename, "data": pdf_bytes})

    if not pdf_items:
        logger.warning("No valid PDF data found in request")
        return Response(
            body={'error': 'PDF data is required'},
            status_code=400
        )

    try:
        # ---- OpenAI ファイルアップロード ----
        uploaded_files: list[dict] = []
        for item in pdf_items:
            pdf_file = io.BytesIO(item["data"])
            pdf_file.name = item["filename"]
            logger.info(f"Uploading PDF file to OpenAI: {pdf_file.name}")
            upload_response = client.files.create(
                file=pdf_file,
                purpose="user_data"
            )
            uploaded_files.append(
                {
                    "filename": item["filename"],
                    "file_id": upload_response.id,
                }
            )
        logger.info(f"Uploaded {len(uploaded_files)} files to OpenAI")

        file_names_str = ", ".join(f["filename"] for f in uploaded_files)
        attachments = [
            {
                "file_id": f["file_id"],
                "tools": [{"type": "code_interpreter"}],
            }
            for f in uploaded_files
        ]

        # ---- タスク抽出 ----
        logger.info("Calling OpenAI for task extraction")
        task_system_prompt = f"""
あなたは防災計画PDFから災害対応タスクを抽出する専門家です。
対象となるPDFファイル: {file_names_str}

### 目的
地域防災計画等から、災害時に必要な具体的な対応タスクをできる限り漏れなく抽出し、
後続処理でグラフ化しやすいように構造化されたJSONとして出力します。

### 出力フォーマット
次の構造を持つJSONオブジェクト**のみ**を返してください（説明文やコードフェンスは一切出力しないこと）:

- ルートオブジェクトに \"tasks\" というキーを1つだけ持つ
- \"tasks\" は配列で、各要素は以下のプロパティを持つ:
  - \"id\": 例 \"t001\" のような一意なID（以降の依存関係で参照できるようにする）
  - \"name\": タスク名（短いラベル）
  - \"department\": 主担当部署名（複数部署の場合はカンマ区切りで列挙してよい）
  - \"description\": タスクの具体的な内容
  - \"category\": 章・節・セクション名など、そのタスクが属する大分類
  - \"source_pdf\": 主に参照したPDFファイル名（複数PDFを統合したタスクの場合は、代表的なものかカンマ区切りで列挙）

### 抽出時の注意点
- 災害応急対策に関する章・節を中心に、時間をかけて網羅的にタスクを抽出してください。
- 同一または非常に類似した内容のタスクが複数PDFに存在する場合は、1つのタスクとして統合してよいですが、
  その場合も description には複数PDFの重要な情報を統合してください。
- JSON以外（解説文、日本語の前置き、コードフェンス ``` など）は一切出力しないでください。
"""

        task_user_message = "防災計画PDF群から災害対応タスクを抽出し、指定のJSONフォーマットで返してください。"

        task_response = client.chat.completions.create(
            model=TASK_EXTRACTION_MODEL,
            messages=[
                {"role": "system", "content": task_system_prompt},
                {
                    "role": "user",
                    "content": task_user_message,
                    "attachments": attachments,
                },
            ],
        )

        task_content = task_response.choices[0].message.content
        logger.info("Raw task extraction response: %s", task_content)
        task_json = _parse_json_response(task_content, expected_root_key="tasks")
        tasks = task_json.get("tasks", [])

        # ---- 依存関係抽出 ----
        logger.info("Calling OpenAI for dependency extraction")
        tasks_json_text = json.dumps({"tasks": tasks}, ensure_ascii=False)

        dependency_system_prompt = f"""
あなたは防災計画に基づくタスク間の依存関係を整理する専門家です。
対象となるPDFファイル: {file_names_str}

以下のタスク一覧(JSON)に対して、タスク同士の依存関係を抽出してください:
{tasks_json_text}

### 依存関係の定義
- あるタスクAを実施する前に完了しているべきタスクBが存在する場合、
  「B が A に先行する依存関係」とみなします。
- 別のカテゴリや別PDFに属するタスク同士の依存も必ず考慮してください。

### 出力フォーマット
次の構造を持つJSONオブジェクト**のみ**を返してください:
- ルートオブジェクトに \"dependencies\" というキーを1つだけ持つ
- \"dependencies\" は配列で、各要素は以下のプロパティを持つ:
  - \"from\": 先行タスクのID（上記tasks配列の \"id\" をそのまま使用）
  - \"to\": 後続タスクのID（同上）
  - \"reason\": その依存関係の理由や根拠となる記述の要約

### 注意
- JSON以外（説明文、日本語の前置き、コードフェンスなど）は一切出力しないでください。
"""

        dependency_user_message = "上記タスク間の依存関係を、指定のJSONフォーマットで抽出してください。"

        dependency_response = client.chat.completions.create(
            model=DEPENDENCY_EXTRACTION_MODEL,
            messages=[
                {"role": "system", "content": dependency_system_prompt},
                {
                    "role": "user",
                    "content": dependency_user_message,
                    "attachments": attachments,
                },
            ],
        )

        dependency_content = dependency_response.choices[0].message.content
        logger.info("Raw dependency extraction response: %s", dependency_content)
        dependency_json = _parse_json_response(
            dependency_content, expected_root_key="dependencies"
        )
        dependencies = dependency_json.get("dependencies", [])

        # 互換性のため、最初のファイルIDを便宜的に返す
        primary_file_id = uploaded_files[0]["file_id"] if uploaded_files else None

        return {
            "tasks": tasks,
            "dependencies": dependencies,
            "files": uploaded_files,
            "file_id": primary_file_id,
            "schema_version": "1.0",
        }
    except Exception as e:
        error_msg = f"OpenAI API error: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return Response(
            body={'error': f'OpenAI API error: {str(e)}'},
            status_code=500
        )


@app.route('/chat_update', methods=['POST'], cors=cors_config)
def chat_update():
    logger.info("Chat update request received")
    data = app.current_request.json_body
    logger.info(f"Request body: {data}")

    if not data:
        logger.warning("Invalid request: Request body is missing")
        return Response(
            body={'error': 'Request body is required'},
            status_code=400
        )

    user_instruction = data.get('instruction')
    file_id = data.get('file_id')
    past_messages = data.get('history', [])

    if not user_instruction:
        logger.warning("Invalid request: Instruction is missing")
        return Response(
            body={'error': 'Instruction is required'},
            status_code=400
        )

    if not file_id:
        logger.warning("Invalid request: File ID is missing")
        return Response(
            body={'error': 'File ID is required'},
            status_code=400
        )

    logger.info(f"Processing chat update with instruction: {user_instruction[:50]}...")

    # 履歴からメッセージ形式に変換
    messages = [{"role": "system", "content": MERMAID_UPDATE_PROMPT_TEMPLATE}]
    for entry in past_messages:
        if 'chart' in entry and entry['chart']:
            # チャートを含むメッセージは内容に追加
            content = entry['content']
            if entry['chart']:
                content += f"\n\n```mermaid\n{entry['chart']}\n```"
            messages.append({"role": entry['role'], "content": content})
        else:
            messages.append({"role": entry['role'], "content": entry['content']})

    # 新しい指示を追加
    messages.append({
        "role": "user",
        "content": user_instruction,
        "attachments": [
                        {
                            "file_id": file_id,
                            "tools": [{"type": "code_interpreter"}]
                        }
                    ]
        }
    )

    try:
        logger.info("Calling OpenAI API for chat update")
        # OpenAI APIの呼び出し方法を修正
        response = client.chat.completions.create(
            model=CHAT_MODEL,
            messages=messages,
        )

        response_content = response.choices[0].message.content

        # Mermaid記法を抽出
        import re
        mermaid_pattern = r"```mermaid\s*([\s\S]*?)\s*```"
        match = re.search(mermaid_pattern, response_content)

        result = {
            "message": response_content  # 常に完全な応答メッセージを返す
        }

        if match:
            flowchart = match.group(1).replace("・", "/")
            logger.info("Extracted mermaid flowchart from response")
            result["flowchart"] = flowchart
        else:
            # Mermaidコードが見つからない場合は、flowchartフィールドを設定しない
            logger.info("No mermaid flowchart found in response")

        return result
    except Exception as e:
        error_msg = f"OpenAI API error: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return Response(
            body={'error': error_msg},
            status_code=500
        )


@app.route('/save_flowchart', methods=['POST'], cors=cors_config)
def save_flowchart_endpoint():
    """
    フローチャートを保存するエンドポイント
    """
    logger.info("Save flowchart endpoint called")
    request_body = app.current_request.json_body

    if not request_body:
        logger.warning("Invalid request: Request body is missing")
        return Response(
            body={'error': 'Request body is required'},
            status_code=400
        )

    chart_code = request_body.get('chart_code')
    location_type = request_body.get('location_type')
    location_name = request_body.get('location_name')
    title = request_body.get('title')
    file_id = request_body.get('file_id')
    chart_id = request_body.get('chart_id')

    if not chart_code:
        logger.warning("Invalid request: Chart code is missing")
        return Response(
            body={'error': 'Chart code is required'},
            status_code=400
        )

    if not location_type:
        logger.warning("Invalid request: Location type is missing")
        return Response(
            body={'error': 'Location type is required'},
            status_code=400
        )

    if not location_name:
        logger.warning("Invalid request: Location name is missing")
        return Response(
            body={'error': 'Location name is required'},
            status_code=400
        )

    if not file_id:
        logger.warning("Invalid request: File ID is missing")
        return Response(
            body={'error': 'File ID is required'},
            status_code=400
        )

    try:
        success, error_message, chart_id = save_flowchart(
            chart_code,
            location_type,
            location_name,
            title,
            chart_id=chart_id,
            file_id=file_id
        )

        if not success:
            logger.error(f"Failed to save flowchart: {error_message}")
            return Response(
                body={'error': error_message},
                status_code=500
            )

        logger.info(f"Flowchart saved successfully with ID: {chart_id}")
        return {
            'id': chart_id,
            'message': 'Flowchart saved successfully'
        }
    except Exception as e:
        error_msg = f"Error saving flowchart: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return Response(
            body={'error': error_msg},
            status_code=500
        )


@app.route('/get_flowchart/{chart_id}', methods=['GET'], cors=cors_config)
def get_flowchart_endpoint(chart_id):
    """
    フローチャートを取得するエンドポイント
    """
    logger.info(f"Get flowchart endpoint called for ID: {chart_id}")

    try:
        flowchart = get_flowchart(chart_id)

        if not flowchart:
            logger.warning(f"Flowchart with ID {chart_id} not found")
            return Response(
                body={'error': 'Flowchart not found'},
                status_code=404
            )

        logger.info(f"Flowchart retrieved successfully: {chart_id}")
        return flowchart
    except Exception as e:
        error_msg = f"Error retrieving flowchart: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return Response(
            body={'error': error_msg},
            status_code=500
        )


@app.route('/list_flowcharts', methods=['GET'], cors=cors_config)
def list_flowcharts_endpoint():
    """
    フローチャートの一覧を取得するエンドポイント
    """
    logger.info("List flowcharts endpoint called")

    # Get query parameters
    query_params = app.current_request.query_params or {}
    location_type = query_params.get('location_type')
    location_name = query_params.get('location_name')

    try:
        flowcharts = list_flowcharts(location_type, location_name)
        logger.info(f"Retrieved {len(flowcharts)} flowcharts")
        return {
            'flowcharts': flowcharts
        }
    except Exception as e:
        error_msg = f"Error listing flowcharts: {str(e)}"
        logger.error(error_msg)
        logger.error(traceback.format_exc())
        return Response(
            body={'error': error_msg},
            status_code=500
        )


@app.route('/delete_flowchart/{chart_id}', methods=['DELETE'], cors=cors_config)
def delete_flowchart_endpoint(chart_id):
    """
    フローチャートを削除するエンドポイント
    """
    try:
        logger.info(f"Delete flowchart endpoint called for ID: {chart_id}")

        # フローチャートの存在確認と削除
        success, error_message = delete_flowchart(chart_id)

        if not success:
            status_code = 404 if "見つかりません" in error_message else 500
            return Response(
                body={'error': error_message},
                status_code=status_code,
                headers={
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'  # CORSヘッダーを追加
                }
            )

        return Response(
            body={'message': 'フローチャートが正常に削除されました', 'id': chart_id},
            status_code=200,
            headers={
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'  # CORSヘッダーを追加
            }
        )
    except Exception as e:
        logger.error(f"Error deleting flowchart: {str(e)}")
        logger.error(traceback.format_exc())
        return Response(
            body={'error': f'フローチャートの削除中にエラーが発生しました: {str(e)}'},
            status_code=500,
            headers={
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'  # CORSヘッダーを追加
            }
        )


@app.route('/health', methods=['GET'], cors=cors_config)
def health_check():
    """
    ヘルスチェックエンドポイント
    """
    logger.info("Health check endpoint called")
    return {'status': 'healthy', 'message': 'Backend service is running'}


@app.route('/flowcharts/default-pdf', methods=['GET'], cors=cors_config)
def get_default_pdf():
    """Get the default PDF for a location"""
    try:
        location_name = request.args.get('location_name')
        if not location_name:
            return Response(
                body={'error': 'Location name is required'},
                status_code=400
            )

        pdf_url = get_default_pdf(location_name)
        if not pdf_url:
            return Response(
                body={'error': 'No PDF found for this location'},
                status_code=404
            )

        return Response(
            body={'pdf_url': pdf_url},
            status_code=200
        )
    except Exception as e:
        logger.error(f"Error getting default PDF: {str(e)}")
        return Response(
            body={'error': str(e)},
            status_code=500
        )
