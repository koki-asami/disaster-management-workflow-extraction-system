# 環境構築（uv 利用）
```bash
$ cd backend
$ uv sync  # .venv を自動作成して依存関係をインストール
```
# 環境変数の設定
```bash
$ cp .env.example .env
```

`.env` では少なくとも以下を設定してください:

```bash
OPENAI_API_KEY=sk-...

# 任意: 利用するモデルを上書き（デフォルトは gpt-5.2）
TASK_EXTRACTION_MODEL=gpt-5.2
DEPENDENCY_EXTRACTION_MODEL=gpt-5.2
CHAT_MODEL=gpt-5.2
```

# 実行（uv 経由）
```bash
$ uv run chalice local --port 8081 --no-autoreload
```

## AWS 上での非同期ジョブ実行について（未対応のインフラ作業）

このリポジトリには、PDF 抽出処理を非同期に実行するための以下のコンポーネントが実装されています:

- S3 上の PDF をページ単位でテキスト抽出するワーカー Lambda 関数 `extraction_worker`
- DynamoDB テーブル:
  - `FLOWCHART_TABLE_NAME + "_uploads"`（アップロード済み PDF のメタ情報）
  - `FLOWCHART_TABLE_NAME + "_jobs"`（抽出ジョブの状態・進捗・結果）
- SQS メッセージを処理するためのコード（`EXTRACTION_QUEUE_URL` を参照）

ただし、**AWS 上で必要となる以下のインフラリソースは、このリポジトリではまだ作成していません**:

- SQS キュー本体（`EXTRACTION_QUEUE_URL` で参照されるもの）
- 上記 SQS キューをトリガーとする Lambda（`extraction_worker`）のイベント設定
- DynamoDB テーブル（`flowcharts_*_uploads`, `flowcharts_*_jobs`）の本番・ステージング用作成
- S3 バケットと IAM ロール／ポリシー（S3・DynamoDB・SQS へのアクセス権）

したがって、**現在の `chalice local` 実行では、同期版 `/analyze_pdf` エンドポイントは動作しますが、SQS 経由の非同期ジョブは AWS インフラの構築が完了するまで実運用できません。**

本番利用時は、別途 IaC（CloudFormation / CDK / Terraform など）や AWS コンソールを用いて、上記リソースを作成・紐づける必要があります。

### ローカル開発時の挙動（SQS なしで動かす）

`POST /extractions` は **実行環境を自動判定**します。

- `chalice local`（ローカル）では **SQS に enqueue せず**、同一プロセス内で `extraction_worker` をバックグラウンド実行します（レスポンスは `202`）。
- AWS Lambda（本番）では **SQS に enqueue** します（`EXTRACTION_QUEUE_URL` が必須）。

その場合でも `GET /extractions/{job_id}` のポーリングで進捗を追跡できます。