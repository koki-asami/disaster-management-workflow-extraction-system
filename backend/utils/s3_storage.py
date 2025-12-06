import boto3
import os
import uuid
import base64
import json
from utils.logger import get_logger

logger = get_logger(__name__)

# Initialize S3 client
s3 = boto3.client('s3')

# Get bucket name from environment variable or use default
BUCKET_NAME = os.environ.get('S3_BUCKET_NAME', 'disaster-management-pdfs')

def create_bucket_if_not_exists():
    """Create the S3 bucket if it doesn't exist"""
    try:
        # Check if bucket exists
        s3.head_bucket(Bucket=BUCKET_NAME)
        logger.info(f"Bucket {BUCKET_NAME} already exists")
    except Exception as e:
        # If bucket doesn't exist, create it
        try:
            s3.create_bucket(
                Bucket=BUCKET_NAME,
                CreateBucketConfiguration={
                    'LocationConstraint': 'ap-northeast-1'  # Tokyo region
                }
            )
            logger.info(f"Created bucket {BUCKET_NAME}")
        except Exception as e:
            logger.error(f"Error creating bucket {BUCKET_NAME}: {str(e)}")
            raise

def upload_pdf(pdf_base64, location_name):
    """Upload a PDF file to S3 and return the object key"""
    try:
        # Create bucket if it doesn't exist
        create_bucket_if_not_exists()
        
        # Generate a unique object key
        object_key = f"{location_name}/pdfs/{uuid.uuid4()}.pdf"
        
        # Decode base64 and upload to S3
        pdf_data = base64.b64decode(pdf_base64)
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=object_key,
            Body=pdf_data,
            ContentType='application/pdf'
        )
        
        logger.info(f"PDF uploaded successfully to {object_key}")
        return object_key
    except Exception as e:
        logger.error(f"Error uploading PDF to S3: {str(e)}")
        raise

def upload_chart_code(chart_code, location_name):
    """Upload chart code to S3 and return the object key"""
    try:
        # Create bucket if it doesn't exist
        create_bucket_if_not_exists()
        
        # Generate a unique object key
        object_key = f"{location_name}/charts/{uuid.uuid4()}.json"
        
        # Upload chart code to S3
        s3.put_object(
            Bucket=BUCKET_NAME,
            Key=object_key,
            Body=chart_code,
            ContentType='application/json'
        )
        
        logger.info(f"Chart code uploaded successfully to {object_key}")
        return object_key
    except Exception as e:
        logger.error(f"Error uploading chart code to S3: {str(e)}")
        raise

def get_pdf_url(object_key):
    """Generate a presigned URL for the PDF file"""
    try:
        url = s3.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': BUCKET_NAME,
                'Key': object_key
            },
            ExpiresIn=3600  # URL expires in 1 hour
        )
        return url
    except Exception as e:
        logger.error(f"Error generating presigned URL: {str(e)}")
        raise

def get_chart_code(object_key):
    """Get chart code from S3"""
    try:
        response = s3.get_object(
            Bucket=BUCKET_NAME,
            Key=object_key
        )
        return response['Body'].read().decode('utf-8')
    except Exception as e:
        logger.error(f"Error getting chart code from S3: {str(e)}")
        raise 