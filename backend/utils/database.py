import boto3
import os
import json
import uuid
from datetime import datetime
from utils.logger import get_logger
from utils.s3_storage import upload_pdf, get_pdf_url, upload_chart_code, get_chart_code

logger = get_logger(__name__)

# Initialize DynamoDB client
dynamodb = boto3.resource('dynamodb')

# Get table name from environment variable or use default
TABLE_NAME = os.environ.get('FLOWCHART_TABLE_NAME', 'flowcharts')


def get_table():
    """Get or create the DynamoDB table"""
    try:
        # Check if table exists
        table = dynamodb.Table(TABLE_NAME)
        table.table_status  # This will raise an exception if table doesn't exist
        return table
    except Exception as e:
        logger.info(f"Table {TABLE_NAME} does not exist, creating: {str(e)}")
        # Create table
        table = dynamodb.create_table(
            TableName=TABLE_NAME,
            KeySchema=[
                {'AttributeName': 'id', 'KeyType': 'HASH'},  # Partition key
            ],
            AttributeDefinitions=[
                {'AttributeName': 'id', 'AttributeType': 'S'},
                {'AttributeName': 'location_type', 'AttributeType': 'S'},
                {'AttributeName': 'location_name', 'AttributeType': 'S'},
            ],
            GlobalSecondaryIndexes=[
                {
                    'IndexName': 'LocationTypeIndex',
                    'KeySchema': [
                        {'AttributeName': 'location_type', 'KeyType': 'HASH'},
                    ],
                    'Projection': {'ProjectionType': 'ALL'},
                    'ProvisionedThroughput': {
                        'ReadCapacityUnits': 5,
                        'WriteCapacityUnits': 5
                    }
                },
                {
                    'IndexName': 'LocationNameIndex',
                    'KeySchema': [
                        {'AttributeName': 'location_name', 'KeyType': 'HASH'},
                    ],
                    'Projection': {'ProjectionType': 'ALL'},
                    'ProvisionedThroughput': {
                        'ReadCapacityUnits': 5,
                        'WriteCapacityUnits': 5
                    }
                }
            ],
            ProvisionedThroughput={
                'ReadCapacityUnits': 5,
                'WriteCapacityUnits': 5
            }
        )
        # Wait for table to be created
        table.meta.client.get_waiter('table_exists').wait(TableName=TABLE_NAME)
        return table


def save_flowchart(chart_code, location_type, location_name, title=None, chart_id=None, file_id=None):
    """Save a flowchart to the database, or update if chart_id is provided"""
    try:
        table = get_table()
        pdf_object_key = None
        chart_object_key = None

        # Check if chart_code is too large for DynamoDB (400KB)
        if len(chart_code) > 400 * 1024:
            try:
                # Upload chart code to S3
                chart_object_key = upload_chart_code(chart_code, location_name)
                # Use a placeholder for DynamoDB
                chart_code = "CHART_STORED_IN_S3"
            except Exception as e:
                error_msg = f"Error uploading chart code to S3: {str(e)}"
                logger.error(error_msg)
                return False, error_msg, None

        # # Handle PDF file separately in S3
        # if pdf_file:
        #     try:
        #         # Upload PDF to S3
        #         pdf_object_key = upload_pdf(pdf_file, location_name)
        #         # Don't store PDF data in DynamoDB, just the object key
        #         pdf_file = None
        #     except Exception as e:
        #         error_msg = f"Error uploading PDF to S3: {str(e)}"
        #         logger.error(error_msg)
        #         return False, error_msg, None

        # Prepare item for DynamoDB
        item = {
            'id': chart_id if chart_id else str(uuid.uuid4()),
            'location_type': location_type,
            'location_name': location_name,
            'chart_code': chart_code,
            'created_at': datetime.now().isoformat(),
            'updated_at': datetime.now().isoformat(),
            'file_id': file_id
        }

        # Add optional fields if provided
        if title:
            item['title'] = title
        if pdf_object_key:
            item['pdf_object_key'] = pdf_object_key
        if chart_object_key:
            item['chart_object_key'] = chart_object_key

        if chart_id:
            # Update existing flowchart
            try:
                response = table.update_item(
                    Key={'id': chart_id},
                    UpdateExpression='SET location_type = :lt, location_name = :ln, chart_code = :cc, updated_at = :ua, file_id = :fid' + 
                                    (', title = :t' if title else '') +
                                    (', pdf_object_key = :pok' if pdf_object_key else '') +
                                    (', chart_object_key = :cok' if chart_object_key else ''),
                    ExpressionAttributeValues={
                        ':lt': location_type,
                        ':ln': location_name,
                        ':cc': chart_code,
                        ':ua': datetime.now().isoformat(),
                        ':fid': file_id,
                        **({':t': title} if title else {}),
                        **({':pok': pdf_object_key} if pdf_object_key else {}),
                        **({':cok': chart_object_key} if chart_object_key else {})
                    },
                    ReturnValues='ALL_NEW'
                )
                logger.info(f"Flowchart {chart_id} updated successfully")
                return True, "Flowchart updated successfully", response['Attributes']
            except Exception as e:
                error_msg = f"Error updating flowchart: {str(e)}"
                logger.error(error_msg)
                return False, error_msg, None
        else:
            # Create new flowchart
            try:
                response = table.put_item(Item=item)
                logger.info(f"New flowchart created with ID: {item['id']}")
                return True, "Flowchart created successfully", item
            except Exception as e:
                error_msg = f"Error creating flowchart: {str(e)}"
                logger.error(error_msg)
                return False, error_msg, None
    except Exception as e:
        error_msg = f"Error saving flowchart: {str(e)}"
        logger.error(error_msg)
        return False, error_msg, None


def get_flowchart(chart_id):
    """Get a flowchart by ID"""
    try:
        table = get_table()
        response = table.get_item(Key={'id': chart_id})

        if 'Item' not in response:
            logger.warning(f"Flowchart with ID {chart_id} not found")
            return None

        item = response['Item']
        
        # If there's a PDF object key, generate a presigned URL
        if 'pdf_object_key' in item:
            try:
                item['pdf_url'] = get_pdf_url(item['pdf_object_key'])
            except Exception as e:
                logger.error(f"Error generating PDF URL: {str(e)}")
                item['pdf_url'] = None
            
        # If chart is stored in S3, fetch it
        if 'chart_object_key' in item:
            try:
                item['chart_code'] = get_chart_code(item['chart_object_key'])
            except Exception as e:
                logger.error(f"Error fetching chart code from S3: {str(e)}")
                item['chart_code'] = None
            
        return item
    except Exception as e:
        logger.error(f"Error getting flowchart: {str(e)}")
        raise


def get_default_pdf(location_name):
    """Get the default PDF for a location"""
    try:
        table = get_table()
        response = table.scan(
            FilterExpression='location_name = :ln AND attribute_exists(pdf_object_key)',
            ExpressionAttributeValues={
                ':ln': location_name
            }
        )
        
        if 'Items' in response and len(response['Items']) > 0:
            # Get the most recent flowchart with a PDF
            items = sorted(response['Items'], key=lambda x: x['created_at'], reverse=True)
            pdf_object_key = items[0]['pdf_object_key']
            return get_pdf_url(pdf_object_key)
        return None
    except Exception as e:
        logger.error(f"Error getting default PDF: {str(e)}")
        return None


def list_flowcharts(location_type=None, location_name=None):
    """List flowcharts with optional filtering"""
    try:
        table = get_table()

        if location_type:
            # Query by location type
            response = table.query(
                IndexName='LocationTypeIndex',
                KeyConditionExpression=boto3.dynamodb.conditions.Key('location_type').eq(location_type)
            )
        elif location_name:
            # Query by location name
            response = table.query(
                IndexName='LocationNameIndex',
                KeyConditionExpression=boto3.dynamodb.conditions.Key('location_name').eq(location_name)
            )
        else:
            # Scan all items
            response = table.scan()

        return response.get('Items', [])
    except Exception as e:
        logger.error(f"Error listing flowcharts: {str(e)}")
        raise


def delete_flowchart(chart_id):
    """Delete a flowchart by ID"""
    try:
        table = get_table()

        # Check if flowchart exists
        response = table.get_item(Key={'id': chart_id})

        if 'Item' not in response:
            logger.warning(f"Flowchart with ID {chart_id} not found for deletion")
            return False, "指定されたIDのフローチャートが見つかりません"

        # Delete the flowchart
        table.delete_item(Key={'id': chart_id})

        logger.info(f"Flowchart with ID {chart_id} deleted successfully")
        return True, None
    except Exception as e:
        logger.error(f"Error deleting flowchart: {str(e)}")
        return False, str(e)
