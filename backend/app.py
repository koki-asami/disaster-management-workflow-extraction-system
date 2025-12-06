from chalice import Chalice, Response, CORSConfig
import openai
import os
from utils.database import (
    save_flowchart,
    get_flowchart,
    list_flowcharts,
    delete_flowchart
)
from utils.logger import get_logger
import base64
import traceback
import io
from dotenv import load_dotenv
from pathlib import Path
import json
import time


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

# OpenAI APIキーの設定
openai.api_key = os.environ.get('OPENAI_API_KEY')
client = openai.OpenAI()
if not openai.api_key:
    logger.error("OPENAI_API_KEY environment variable is not set")

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


@app.route('/analyze_pdf', methods=['POST'], cors=cors_config)
def analyze_pdf():
    logger.info("PDF analysis request received")
    request_body = app.current_request.json_body

    if not request_body or 'pdf_data' not in request_body:
        logger.warning("Invalid request: PDF data is missing")
        return Response(
            body={'error': 'PDF data is required'},
            status_code=400
        )

    # Get PDF filename from request
    pdf_filename = request_body.get('filename', '地域防災計画.pdf')

    # Base64エンコードされたPDFデータをデコード
    try:
        logger.info("Decoding PDF data")
        pdf_data = base64.b64decode(request_body.get('pdf_data'))
        logger.info(f"PDF data decoded, size: {len(pdf_data)} bytes")
    except Exception as e:
        logger.error(f"Failed to decode PDF data: {str(e)}")
        return Response(
            body={'error': f'Invalid PDF data: {str(e)}'},
            status_code=400
        )

    try:
        # PDFファイルをバイナリとして準備
        pdf_file = io.BytesIO(pdf_data)
        pdf_file.name = pdf_filename
        logger.info(f"PDF file name: {pdf_file.name}")

        user_message = f"タスクを抽出してください。ファイル名: {pdf_filename}"
        logger.info("Calling OpenAI API")

        # ファイルをアップロード
        try:
            upload_response = client.files.create(
                file=pdf_file,
                purpose="user_data"
            )
            file_id = upload_response.id
            logger.info(f"File uploaded successfully with ID: {file_id}")

        except Exception as e:
            logger.error(f"Error uploading file: {str(e)}")
            return Response(
                body={'error': f'Failed to upload file: {str(e)}'},
                status_code=500
            )

        for i in range(10):
            logger.info(f"Processing {i}th time")
            start_t = time.time()
            TASK_PROMPT_TEMPLATE_1 = f"""
                あなたは添付ファイル({pdf_filename})を基に、災害時に必要な対応項目と詳細のタスクを抽出する必要があります。
                次の作業手順を踏まえ、結果を指定のjson形式で出力してください。
                json以外の文字は出力しないでください。

                """
            TASK_PROMPT_TEMPLATE_2 = """
                ### 作業手順
                1. アップロードされた地域防災計画を精査し、節ごとにタスクと担当部署を抽出してください。災害応急対策章から抽出すると効率的に抽出できると思います
                - subgraph単位のタスクは目次の対策章から抽出すると効率的に抽出できると思います
                - その後、subgraphの内容が記載された節を訪れ、nodeとなる情報を抽出してください
                2. 他の節や章を参照しているタスクがある場合は、その節や章を訪れて、実際に記載されている内容も確認して情報を補足してください
                3. 各タスクの具体的な説明を含めてください

                ### 抽出時の注意点
                - 時間をかけて良いのでゆっくり丁寧に記載されているすべての災害対応項目とタスクを抽出してください
                - 抽出する災害対応項目名とタスクの個数の制限はありません、100個でも1000個でも良いので漏れがないように抽出してください

                ### 出力形式
                {
                    "災害対応項目名": [
                        {
                            "task": "タスク名",
                            "department": "担当部署",
                            "description": "タスクの具体的な説明"
                        },
                        {....},
                    ],
                    ...,
                }
            """


            response = client.chat.completions.create(
                model="o1-2024-12-17",
                messages=[
                    {"role": "system", "content": TASK_PROMPT_TEMPLATE_1 + TASK_PROMPT_TEMPLATE_2},
                    {
                        "role": "user",
                        "content": user_message,
                        "attachments": [
                            {
                                "file_id": file_id,
                                "tools": [{"type": "code_interpreter"}]
                            }
                        ]
                    }
                ],
            )

            extracted_tasks = response.choices[0].message.content
            logger.info("extracted_tasks: %s", extracted_tasks)
            task_t = time.time() - start_t

            DEPENDENCY_PROMPT_TEMPLATE_1 = f"""
                あなたは抽出された詳細タスクと{pdf_filename}をもとに、詳細タスク間の依存関係を整理する必要があります。
                次の作業手順を踏まえ、結果を指定のjson形式で出力してください。
                json以外の文字は出力しないでください。(`\n`なども出力しないでください)

                ### 作業手順
                - 抽出された詳細タスクと{pdf_filename}をもとに、抽出した詳細タスク間の依存関係を整理してください
                - 依存関係とはその詳細タスクを実施する前に実施されるべき詳細タスクのことを指します

                ### 抽出時の注意点
                - 依存関係は複数ある可能性があります
                - 依存関係は他の災害対応項目に存在する詳細タスクとの間に存在する場合もあるので、網羅的に整理してください
                - 時間をかけて良いのでゆっくり丁寧に依存関係を整理してください
            """
            DEPENDENCY_PROMPT_TEMPLATE_2 = """
                ### 出力形式
                {
                    "災害対応項目名": [
                        {
                            "task": "タスク名",
                            "department": "担当部署",
                            "description": "タスクの具体的な説明",
                            "dependencies": [
                                "災害対応項目名",   # 依存関係のあるタスク名をリスト形式で記載
                            ]
                        },
                        {....},
                    ],
                    ...,
                }

                ### 抽出された災害対応項目と詳細タスク
                下記の抽出された災害対応項目と詳細タスクに追記をする形で、依存関係を記載してください。出力形式を守るようにしてください。
            """

            response = client.chat.completions.create(
                model="o1-2024-12-17",
                messages=[
                    {"role": "system", "content": DEPENDENCY_PROMPT_TEMPLATE_1 + DEPENDENCY_PROMPT_TEMPLATE_2 + "\n" + extracted_tasks},
                    {
                        "role": "user",
                        "content": "抽出したタスクに依存関係を記載してください。",
                        "attachments": [
                            {
                                "file_id": file_id,
                                "tools": [{"type": "code_interpreter"}]
                            }
                        ]
                    }
                ],
            )

            extracted_tasks_with_dependency = response.choices[0].message.content
            extracted_tasks_with_dependency_json = json.loads(extracted_tasks_with_dependency)
            logger.info("extracted_tasks_with_dependency: %s", extracted_tasks_with_dependency)
            dependency_t = time.time() - start_t

            # タスク数の計算
            total_tasks = 0
            for category in extracted_tasks_with_dependency_json.values():
                total_tasks += len(category)

            # 結果を保存
            output_dir = Path("output")
            output_dir.mkdir(parents=True, exist_ok=True)
            dependency_file = output_dir / f"v1__{i}.json"
            res = {
                "task_t": task_t,
                "dependency_t": dependency_t,
                "extracted_tasks_with_dependency": extracted_tasks_with_dependency_json,
                "total_tasks": total_tasks,
            }
            with open(dependency_file, "w", encoding="utf-8") as f:
                json.dump(res, f, ensure_ascii=False)
            logger.info("dependencies saved to %s", dependency_file)
            logger.info("extracted_tasks_with_dependency: %s", extracted_tasks_with_dependency)

            response = client.chat.completions.create(
                model="gpt-4.5-preview-2025-02-27",
                messages=[
                    {"role": "system", "content": MERMAID_PROMPT_TEMPLATE + "\n" + extracted_tasks_with_dependency},
                    {
                        "role": "user",
                        "content": "フローチャートを作成してください。",
                    }
                ],
            )
            flowchart_md = response.choices[0].message.content.replace("・", "/")
            logger.info(f"Successfully generated flowchart: {flowchart_md}...")
            time_file = output_dir / f"v1__{i}_t.json"
            res = {
                "task_t": task_t,
                "dependency_t": dependency_t,
                "total_time": time.time() - start_t,
            }
            with open(time_file, "w", encoding="utf-8") as f:
                json.dump(res, f, ensure_ascii=False)
        return {
            "flowchart": flowchart_md,
            "file_id": file_id
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
            model="gpt-4.5-preview-2025-02-27",
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
