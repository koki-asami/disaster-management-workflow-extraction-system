import boto3
import json
import os
import uuid
from datetime import datetime
from utils.logger import get_logger
from utils.s3_storage import (
    get_pdf_url,
    upload_chart_code,
    get_chart_code,
    upload_graph_data,
    get_graph_data,
)

logger = get_logger(__name__)

# Initialize DynamoDB client
dynamodb = boto3.resource("dynamodb")

# Main flowchart table
TABLE_NAME = os.environ.get("FLOWCHART_TABLE_NAME", "flowcharts")

# DynamoDB item limit 400KB; keep graph_data inline only if under this (rest is chart_code, etc.)
GRAPH_DATA_SIZE_THRESHOLD = 200 * 1024

# Uploads / Jobs tables (plan-based; names chosen to stay within flowcharts* for IAM)
UPLOADS_TABLE_NAME = os.environ.get("UPLOADS_TABLE_NAME", TABLE_NAME + "_uploads")
JOBS_TABLE_NAME = os.environ.get("EXTRACTION_JOBS_TABLE_NAME", TABLE_NAME + "_jobs")


def _get_or_create_table(
    table_name: str,
    key_schema,
    attribute_definitions,
    global_secondary_indexes=None,
):
    """Generic helper to get or create a DynamoDB table."""
    try:
        table = dynamodb.Table(table_name)
        # Accessing table_status forces a DescribeTable
        _ = table.table_status
        return table
    except Exception as e:
        logger.info("Table %s does not exist, creating: %s", table_name, str(e))
        params = {
            "TableName": table_name,
            "KeySchema": key_schema,
            "AttributeDefinitions": attribute_definitions,
            "ProvisionedThroughput": {"ReadCapacityUnits": 5, "WriteCapacityUnits": 5},
        }
        if global_secondary_indexes:
            params["GlobalSecondaryIndexes"] = global_secondary_indexes

        table = dynamodb.create_table(**params)
        table.meta.client.get_waiter("table_exists").wait(TableName=table_name)
        return table


def get_table():
    """Get or create the main flowcharts table."""
    return _get_or_create_table(
        TABLE_NAME,
        key_schema=[{"AttributeName": "id", "KeyType": "HASH"}],
        attribute_definitions=[
            {"AttributeName": "id", "AttributeType": "S"},
            {"AttributeName": "location_type", "AttributeType": "S"},
            {"AttributeName": "location_name", "AttributeType": "S"},
        ],
        global_secondary_indexes=[
            {
                "IndexName": "LocationTypeIndex",
                "KeySchema": [
                    {"AttributeName": "location_type", "KeyType": "HASH"}
                ],
                "Projection": {"ProjectionType": "ALL"},
                "ProvisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5,
                },
            },
            {
                "IndexName": "LocationNameIndex",
                "KeySchema": [
                    {"AttributeName": "location_name", "KeyType": "HASH"}
                ],
                "Projection": {"ProjectionType": "ALL"},
                "ProvisionedThroughput": {
                    "ReadCapacityUnits": 5,
                    "WriteCapacityUnits": 5,
                },
            },
        ],
    )


def save_flowchart(chart_code, location_type, location_name, title=None, chart_id=None, file_id=None, graph_data=None):
    """Save a flowchart to the database, or update if chart_id is provided"""
    try:
        table = get_table()
        # DynamoDB には空文字列は保存できないため、None の場合は空文字に統一して扱う
        chart_code = chart_code or ""
        pdf_object_key = None
        chart_object_key = None

        # Check if chart_code is too large for DynamoDB (400KB)
        if chart_code and len(chart_code) > 400 * 1024:
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
        if graph_data is not None:
            gd_serialized = json.dumps(graph_data, ensure_ascii=False)
            if len(gd_serialized) > GRAPH_DATA_SIZE_THRESHOLD:
                try:
                    graph_data_s3_key = upload_graph_data(
                        graph_data, location_name, chart_id=item["id"]
                    )
                    item["graph_data_s3_key"] = graph_data_s3_key
                except Exception as e:
                    error_msg = f"Error uploading graph_data to S3: {str(e)}"
                    logger.error(error_msg)
                    return False, error_msg, None
            else:
                item["graph_data"] = graph_data

        if chart_id:
            # Update existing flowchart
            try:
                update_expr = (
                    'SET location_type = :lt, location_name = :ln, chart_code = :cc, '
                    'updated_at = :ua, file_id = :fid'
                )
                expr_values = {
                    ':lt': location_type,
                    ':ln': location_name,
                    ':cc': chart_code,
                    ':ua': datetime.now().isoformat(),
                    ':fid': file_id,
                }
                if title:
                    update_expr += ', title = :t'
                    expr_values[':t'] = title
                if pdf_object_key:
                    update_expr += ', pdf_object_key = :pok'
                    expr_values[':pok'] = pdf_object_key
                if chart_object_key:
                    update_expr += ', chart_object_key = :cok'
                    expr_values[':cok'] = chart_object_key

                if graph_data is not None:
                    gd_serialized = json.dumps(graph_data, ensure_ascii=False)
                    if len(gd_serialized) > GRAPH_DATA_SIZE_THRESHOLD:
                        graph_data_s3_key = upload_graph_data(
                            graph_data, location_name, chart_id=chart_id
                        )
                        update_expr += ', graph_data_s3_key = :gdk'
                        expr_values[':gdk'] = graph_data_s3_key
                        update_expr += ' REMOVE graph_data'
                    else:
                        update_expr += ', graph_data = :gd'
                        expr_values[':gd'] = graph_data
                        update_expr += ' REMOVE graph_data_s3_key'

                response = table.update_item(
                    Key={'id': chart_id},
                    UpdateExpression=update_expr,
                    ExpressionAttributeValues=expr_values,
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

        # If graph_data is stored in S3, fetch it
        if 'graph_data_s3_key' in item:
            try:
                item['graph_data'] = get_graph_data(item['graph_data_s3_key'])
            except Exception as e:
                logger.error(f"Error fetching graph_data from S3: {str(e)}")
                item['graph_data'] = None

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


# ===== Uploads table helpers (for Upload→Select→Extract flow) =====

def get_uploads_table():
    """Get or create the uploads table."""
    return _get_or_create_table(
        UPLOADS_TABLE_NAME,
        key_schema=[{"AttributeName": "upload_id", "KeyType": "HASH"}],
        attribute_definitions=[
            {"AttributeName": "upload_id", "AttributeType": "S"},
        ],
        global_secondary_indexes=None,
    )


def create_upload_record(filename: str, object_key: str, status: str = "pending", size_bytes: int | None = None) -> dict:
    """Create a new upload record."""
    table = get_uploads_table()
    upload_id = str(uuid.uuid4())
    now = datetime.now().isoformat()
    item = {
        "upload_id": upload_id,
        "filename": filename,
        "object_key": object_key,
        "status": status,
        "created_at": now,
        "updated_at": now,
    }
    if size_bytes is not None:
        item["size_bytes"] = int(size_bytes)

    table.put_item(Item=item)
    logger.info("Created upload record %s for %s", upload_id, filename)
    return item


def list_uploads() -> list[dict]:
    """List all upload records."""
    table = get_uploads_table()
    resp = table.scan()
    return resp.get("Items", [])


def mark_upload_complete(upload_id: str, size_bytes: int | None = None) -> dict | None:
    """Mark an upload as completed."""
    table = get_uploads_table()
    expr = "SET #st = :s, updated_at = :u"
    values = {
        ":s": "uploaded",
        ":u": datetime.now().isoformat(),
    }
    names = {"#st": "status"}
    if size_bytes is not None:
        expr += ", size_bytes = :b"
        values[":b"] = int(size_bytes)

    try:
        resp = table.update_item(
            Key={"upload_id": upload_id},
            UpdateExpression=expr,
            ExpressionAttributeValues=values,
            ExpressionAttributeNames=names,
            ReturnValues="ALL_NEW",
        )
        item = resp.get("Attributes")
        logger.info("Marked upload %s as completed", upload_id)
        return item
    except Exception as e:
        logger.error("Error marking upload %s as complete: %s", upload_id, str(e))
        return None


def get_upload(upload_id: str) -> dict | None:
    """Fetch a single upload record."""
    table = get_uploads_table()
    resp = table.get_item(Key={"upload_id": upload_id})
    return resp.get("Item")


def delete_upload_record(upload_id: str) -> bool:
    """Delete an upload record."""
    table = get_uploads_table()
    try:
        table.delete_item(Key={"upload_id": upload_id})
        logger.info("Deleted upload record %s", upload_id)
        return True
    except Exception as e:
        logger.error("Error deleting upload record %s: %s", upload_id, str(e))
        return False


# ===== Jobs table helpers (for async extraction worker) =====


def get_jobs_table():
    """Get or create the extraction jobs table."""
    return _get_or_create_table(
        JOBS_TABLE_NAME,
        key_schema=[{"AttributeName": "job_id", "KeyType": "HASH"}],
        attribute_definitions=[
            {"AttributeName": "job_id", "AttributeType": "S"},
        ],
        global_secondary_indexes=None,
    )


def create_job(
    uploads: list[dict],
    status: str = "queued",
) -> dict:
    """
    Create a new extraction job record.

    uploads: list of items like {"upload_id": ..., "object_key": ..., "filename": ...}
    """
    table = get_jobs_table()
    job_id = str(uuid.uuid4())
    now = datetime.now().isoformat()

    item: dict = {
        "job_id": job_id,
        "status": status,
        "created_at": now,
        "updated_at": now,
        "uploads": uploads,
        "processed_pages": 0,
        "total_pages": 0,
        "progress": 0,
    }

    table.put_item(Item=item)
    logger.info("Created extraction job %s", job_id)
    return item


def update_job_progress(
    job_id: str,
    processed_pages: int | None = None,
    total_pages: int | None = None,
    status: str | None = None,
    phase: str | None = None,
    detail: str | None = None,
    progress: int | None = None,
    phase_current: int | None = None,
    phase_total: int | None = None,
    phase_unit: str | None = None,
) -> dict | None:
    """
    Update an extraction job's progress.

    - progress が与えられた場合は progress(0-100) を明示的に更新（最優先）。
    - processed_pages / total_pages が与えられた場合は progress(0-100) も自動更新（progress 未指定時）。
    - status が与えられた場合はステータスも更新。
    - phase/detail が与えられた場合は処理フェーズの表示用に保存。
    """
    table = get_jobs_table()

    expr_parts = ["updated_at = :u"]
    values: dict = {
        ":u": datetime.now().isoformat(),
    }

    if processed_pages is not None:
        expr_parts.append("processed_pages = :pp")
        values[":pp"] = int(processed_pages)
    if total_pages is not None:
        expr_parts.append("total_pages = :tp")
        values[":tp"] = int(total_pages)
    if status is not None:
        expr_parts.append("#st = :s")
        values[":s"] = status
    if phase is not None:
        expr_parts.append("phase = :ph")
        values[":ph"] = phase
    if detail is not None:
        expr_parts.append("detail = :dt")
        values[":dt"] = detail
    if phase_current is not None:
        expr_parts.append("phase_current = :pc")
        values[":pc"] = int(phase_current)
    if phase_total is not None:
        expr_parts.append("phase_total = :pt")
        values[":pt"] = int(phase_total)
    if phase_unit is not None:
        expr_parts.append("phase_unit = :pu")
        values[":pu"] = str(phase_unit)

    # 進捗率の更新
    if progress is not None:
        expr_parts.append("progress = :pr")
        values[":pr"] = int(max(0, min(100, progress)))
    elif processed_pages is not None and total_pages:
        # 進捗率の計算（processed / total）
        try:
            computed = int(max(0, min(100, (processed_pages / total_pages) * 100)))
        except ZeroDivisionError:
            computed = 0
        expr_parts.append("progress = :pr")
        values[":pr"] = computed

    update_expr = "SET " + ", ".join(expr_parts)
    names = {"#st": "status"} if status is not None else None

    try:
        kwargs: dict = {
            "Key": {"job_id": job_id},
            "UpdateExpression": update_expr,
            "ExpressionAttributeValues": values,
            "ReturnValues": "ALL_NEW",
        }
        if names:
            kwargs["ExpressionAttributeNames"] = names

        resp = table.update_item(**kwargs)
        item = resp.get("Attributes")
        logger.info(
            "Updated extraction job %s (processed=%s, total=%s, status=%s)",
            job_id,
            processed_pages,
            total_pages,
            status,
        )
        return item
    except Exception as e:
        logger.error("Error updating extraction job %s: %s", job_id, str(e))
        return None


def save_job_result(
    job_id: str,
    result_s3_key: str,
    summary: dict | None = None,
) -> dict | None:
    """
    Mark an extraction job as completed and store result location.

    - result_s3_key: S3 object key where the final JSON (tasks/dependencies) is stored.
    - summary: optional small JSON summary (e.g. counts) to keep in DynamoDB.
    """
    table = get_jobs_table()
    now = datetime.now().isoformat()
    expr = "SET #st = :s, result_s3_key = :rk, updated_at = :u"
    values: dict = {
        ":s": "completed",
        ":rk": result_s3_key,
        ":u": now,
    }
    names = {"#st": "status"}

    if summary is not None:
        expr += ", summary = :sm"
        values[":sm"] = summary

    try:
        resp = table.update_item(
            Key={"job_id": job_id},
            UpdateExpression=expr,
            ExpressionAttributeValues=values,
            ExpressionAttributeNames=names,
            ReturnValues="ALL_NEW",
        )
        item = resp.get("Attributes")
        logger.info("Saved extraction result for job %s", job_id)
        return item
    except Exception as e:
        logger.error("Error saving extraction result for job %s: %s", job_id, str(e))
        return None


def get_job(job_id: str) -> dict | None:
    """Fetch a single extraction job record. Uses ConsistentRead for latest progress."""
    table = get_jobs_table()
    try:
        resp = table.get_item(Key={"job_id": job_id}, ConsistentRead=True)
        return resp.get("Item")
    except Exception as e:
        logger.error("Error getting extraction job %s: %s", job_id, str(e))
        return None
