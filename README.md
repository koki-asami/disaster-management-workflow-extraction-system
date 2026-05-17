# Disaster Management Workflow Extraction System

## システム概要

![システム概要](image/Overview.png)

## 概要
PDF資料から防災計画のワークフローを抽出し、可視化するシステムです。

## 環境構築

### 必須要件
- Node.js（v20 推奨・CI と一致）
- Python（3.9 以上; Docker イメージは 3.11）
- Docker（本番用イメージのビルド・ECR 利用時）
- AWS CLI（デプロイ・検証時）

### セットアップ手順

1. リポジトリのクローン
```bash
git clone https://github.com/koki-asami/disaster-management-workflow-extraction-system.git
cd disaster-management-workflow-extraction-system
```

2. バックエンドの設定（uv 利用）
```bash
cd backend

# 依存関係のインストール & 仮想環境の作成（.venv）
uv sync
```

**重要: API キーとテーブル名**

Chalice は使いません。`backend` 直下に `.env` を作成し、少なくとも次を設定してください（変数名は [docs/ENV_MAPPING.md](docs/ENV_MAPPING.md) も参照）。

```bash
OPENAI_API_KEY=sk-...
FLOWCHART_TABLE_NAME=flowcharts_dev
# 任意: S3_BUCKET_NAME=...（未設定時はコード側デフォルト）
```

3. フロントエンドの設定
```bash
cd ../frontend
npm install
```

### 実行方法

1. バックエンドの起動（別ターミナル）
```bash
cd backend
uv run uvicorn dmwe_api.main:app --reload --host 0.0.0.0 --port 8000
```

- ヘルスチェック: `GET http://127.0.0.1:8000/health`
- アプリ API: `http://127.0.0.1:8000/api/v1/...`（例: 同期解析 `POST /api/v1/analyze_pdf`）

`POST /api/v1/analyze_pdf` は、アップロードされた PDF（複数可）から LLM を用いて災害対応タスクとタスク間の依存関係を抽出し、次のような JSON を返します:

```json
{
  "tasks": [
    {
      "id": "t001",
      "name": "避難所開設",
      "department": "防災課",
      "description": "避難所の鍵の確保と設備点検を行う…",
      "category": "避難所運営",
      "source_pdf": "A市地域防災計画.pdf"
    }
  ],
  "dependencies": [
    {
      "from": "t001",
      "to": "t010",
      "reason": "資機材準備完了後に実施"
    }
  ]
}
```

2. フロントエンドの起動（別ターミナル）
```bash
cd frontend
npm run dev
```

Vite のデフォルトでは `http://localhost:5173` です。API は開発時プロキシで `http://127.0.0.1:8000` に届きます（`vite.config.mjs` の `/api`・`/health`）。

## AWS へのデプロイ

本システムを AWS 上に dev・prod として載せる場合の典型的な構成は次のとおりです。

- **バックエンド**: `backend/Dockerfile` でビルドしたコンテナを **ECR** に push し、**ECS（Fargate）・App Runner** などで `uvicorn dmwe_api.main:app` を起動
- **非同期ワーカー**（任意）: SQS トリガーの Lambda でハンドラ **`worker_handler.handler`**（[backend/worker_handler.py](backend/worker_handler.py)）
- **フロントエンド**: **S3 + CloudFront**（ビルド成果物は Vite の **`frontend/dist`**）

詳細手順・GitHub Actions・変数一覧:

- **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** — 手動デプロイと CI/CD
- **[docs/AWS_RESOURCES.md](docs/AWS_RESOURCES.md)** — AWS リソースの整理
- **[docs/ENV_MAPPING.md](docs/ENV_MAPPING.md)** — 環境変数・dev/prod 対応

GitHub Actions の [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) は **ECR へ API イメージを push** し、**フロントを `frontend/dist` から S3 同期**します。フロントのビルドにはリポジトリ Variables の **`BACKEND_API_URL_DEV` / `BACKEND_API_URL_PROD`**（API のパブリックオリジン、末尾スラッシュなし）が必要です。
