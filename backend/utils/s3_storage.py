import boto3
import json
import os
import uuid
import base64
from utils.logger import get_logger

logger = get_logger(__name__)

# Initialize S3 client
s3 = boto3.client('s3')

# Get bucket name from environment variable or use default
BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'disaster-management-pdfs')


def create_bucket_if_not_exists():
    """Create the S3 bucket if it doesn't exist."""
    try:
        s3.head_bucket(Bucket=BUCKET_NAME)
        logger.info(f"Bucket {BUCKET_NAME} already exists")
    except Exception:
        try:
            s3.create_bucket(
                Bucket=BUCKET_NAME,
                CreateBucketConfiguration={
                    'LocationConstraint': 'ap-northeast-1'  # Tokyo region
                },
            )
            logger.info(f"Created bucket {BUCKET_NAME}")
        except Exception as e:
            logger.error(f"Error creating bucket {BUCKET_NAME}: {str(e)}")
            raise


def upload_pdf(pdf_base64: str, location_name: str) -> str:
    """Upload a PDF file (base64) to S3 and return the object key."""
    try:
        create_bucket_if_not_exists()

        object_key = f"{location_name}/pdfs/{uuid.uuid4()}.pdf"

        pdf_data = base64.b64decode(pdf_base64)
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=object_key,
            Body=pdf_data,
            ContentType="application/pdf",
        )

        logger.info("PDF uploaded successfully to %s", object_key)
        return object_key
    except Exception as e:
        logger.error("Error uploading PDF to S3: %s", str(e))
        raise


def upload_chart_code(chart_code: str, location_name: str) -> str:
    """Upload chart code to S3 and return the object key."""
    try:
        create_bucket_if_not_exists()

        object_key = f"{location_name}/charts/{uuid.uuid4()}.json"

        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=object_key,
            Body=chart_code,
            ContentType="application/json",
        )

        logger.info("Chart code uploaded successfully to %s", object_key)
        return object_key
    except Exception as e:
        logger.error("Error uploading chart code to S3: %s", str(e))
        raise


def get_pdf_url(object_key: str) -> str:
    """Generate a presigned URL for the PDF file."""
    try:
        url = s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": BUCKET_NAME, "Key": object_key},
            ExpiresIn=3600,  # URL expires in 1 hour
        )
        return url
    except Exception as e:
        logger.error("Error generating presigned URL: %s", str(e))
        raise


def get_chart_code(object_key: str) -> str:
    """Get chart code from S3."""
    try:
        response = s3.get_object(Bucket=BUCKET_NAME, Key=object_key)
        return response["Body"].read().decode("utf-8")
    except Exception as e:
        logger.error("Error getting chart code from S3: %s", str(e))
        raise


def upload_graph_data(graph_data: dict, location_name: str, chart_id: str | None = None) -> str:
    """Upload graph_data JSON to S3 and return the object key."""
    try:
        create_bucket_if_not_exists()
        suffix = f"{chart_id}" if chart_id else str(uuid.uuid4())
        object_key = f"{location_name}/graph_data/{suffix}.json"
        body = json.dumps(graph_data, ensure_ascii=False)
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=object_key,
            Body=body,
            ContentType="application/json",
        )
        logger.info("Graph data uploaded successfully to %s", object_key)
        return object_key
    except Exception as e:
        logger.error("Error uploading graph data to S3: %s", str(e))
        raise


def get_graph_data(object_key: str) -> dict:
    """Get graph_data JSON from S3."""
    try:
        response = s3.get_object(Bucket=BUCKET_NAME, Key=object_key)
        body = response["Body"].read().decode("utf-8")
        return json.loads(body)
    except Exception as e:
        logger.error("Error getting graph data from S3: %s", str(e))
        raise


def create_presigned_upload_url(
    object_key: str,
    content_type: str,
    expires_in: int = 3600,
) -> str:
    """Create a presigned URL for uploading an object via PUT."""
    try:
        create_bucket_if_not_exists()
        url = s3.generate_presigned_url(
            ClientMethod="put_object",
            Params={
                "Bucket": BUCKET_NAME,
                "Key": object_key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_in,
        )
        logger.info("Generated presigned upload URL for %s", object_key)
        return url
    except Exception as e:
        logger.error("Error generating presigned upload URL: %s", str(e))
        raise


def delete_object(object_key: str) -> None:
    """Delete an object from S3."""
    try:
        s3.delete_object(Bucket=BUCKET_NAME, Key=object_key)
        logger.info("Deleted S3 object %s", object_key)
    except Exception as e:
        logger.error("Error deleting S3 object %s: %s", object_key, str(e))
        raise
