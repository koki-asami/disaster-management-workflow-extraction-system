# 環境変数マッピング（dev / prod）

CI/CD（GitHub Actions）および手動デプロイ時に参照する、環境ごとの変数一覧です。バックエンドは **FastAPI コンテナ**（Chalice なし）です。

## 1. デプロイ先の切り替え

| トリガー | デプロイ先 |
|----------|------------|
| `main` ブランチへの push | **dev** |
| `v*` タグへの push（例: `v1.0.0`） | **prod** |

## 2. バックエンド（コンテナ / ランタイム）

アプリの環境変数は **ECS タスク定義・App Runner・ローカル `.env`** 等で設定します。

| 変数名 | dev 例 | prod 例 | 備考 |
|--------|--------|---------|------|
| `OPENAI_API_KEY` | （秘密情報） | 同上 | 本番は Secrets Manager 推奨 |
| `FLOWCHART_TABLE_NAME` | `flowcharts_dev` | `flowcharts_prod` | DynamoDB ベース名（`_uploads` / `_jobs` が接尾辞で付く） |
| `S3_BUCKET_NAME` | `dmwe-pdfs-dev` | `dmwe-pdfs-prod` | 未設定時はコードデフォルト |
| `FLOWCHART_S3_ROOT` | （省略可） | 同上 | 保存済みフローチャートの肥大データを S3 に退避するときのプレフィックス。**省略時は既定 `saved-flowcharts/v2`**（`saved-flowcharts/v2/<location>/charts/` および `.../graph_data/`）。IAM でプレフィックス制限がある場合は当該パスを許可する。従来の `{location}/charts` 配置のみに戻すには `FLOWCHART_S3_ROOT=`（空文字）を明示 |
| `EXTRACTION_QUEUE_URL` | （SQS キュー URL） | 同上 | Lambda 上の API で非同期投入する場合**必須**。ローカル uvicorn では未設定可 |
| `EXTRACTION_MODE` | `batch` | `batch` | 非同期 worker の主経路。ローカル smoke のみ `sync` 可 |
| `COGNITO_REGION` | `ap-northeast-1` | 同上 | Cognito JWT 検証用 |
| `COGNITO_USER_POOL_ID` | User Pool ID | 同上 | 認証有効時に必須 |
| `COGNITO_APP_CLIENT_ID` | App client ID | 同上 | 設定時は JWT の `aud` / `client_id` を検証 |
| `TASK_EXTRACTION_MODEL` 等 | 任意 | 任意 | モデル名の上書き |

**API コンテナ**は `uvicorn dmwe_api.main:app` を起動し、HTTP API と SQS enqueue を担当します。**SQS ワーカー Lambda**（`worker_handler.handler`）は PDF 抽出、OpenAI Batch submit/poll、結果保存を担当します。ワーカーには API と同等の DB/S3/OpenAI 設定に加え、SQS トリガーを紐付けます。

## 3. コンテナレジストリ（ECR）

GitHub Actions の `deploy.yml` は次のリポジトリ名に push します（アカウントリージョンは Variables の `AWS_REGION`）。

| 環境 | ECR リポジトリ名（既定） | タグ例 |
|------|-------------------------|--------|
| dev | `dmwe-api-dev` | `latest`, `<git sha>` |
| prod | `dmwe-api-prod` | 同上 |

初回 push 時にリポジトリが無ければ、AWS コンソールまたは CLI で作成してください（ワークフローは作成しません）。

## 4. フロントエンド（Vite ビルド + S3 + CloudFront）

| 変数名 | dev | prod | 備考 |
|--------|-----|------|------|
| `VITE_API_ORIGIN` | dev API のオリジン（末尾スラッシュなし） | prod 用 | CI では `BACKEND_API_URL_DEV` / `BACKEND_API_URL_PROD` から注入 |
| `VITE_API_PREFIX` | `/api/v1` | `/api/v1` | CI の `deploy.yml` で固定 |
| `VITE_COGNITO_DOMAIN` | Hosted UI domain | 同上 | `https://...amazoncognito.com` 形式 |
| `VITE_COGNITO_APP_CLIENT_ID` | App client ID | 同上 | backend の `COGNITO_APP_CLIENT_ID` と一致 |
| `VITE_COGNITO_REDIRECT_URI` | dev フロント URL | prod フロント URL | Cognito App client の callback URL に登録 |
| `VITE_COGNITO_LOGOUT_URI` | dev フロント URL | prod フロント URL | Cognito App client の sign-out URL に登録 |
| `VITE_AUTH_DISABLED` | `true`（必要時のみ） | 未設定 | ローカル開発用 |
| `FRONTEND_BUCKET` | `dmwe-frontend-dev` | `dmwe-frontend-prod` | ワークフロー内固定（変更時は `deploy.yml` を編集） |
| CloudFront ID | Variables: `CLOUDFRONT_DISTRIBUTION_ID_DEV` | `CLOUDFRONT_DISTRIBUTION_ID_PROD` | 任意（空なら無効化スキップ） |

**手動ビルド例**

```bash
cd frontend
export VITE_API_ORIGIN=https://api-dev.example.com
export VITE_API_PREFIX=/api/v1
npm run build
aws s3 sync dist s3://dmwe-frontend-dev --delete
```

## 5. GitHub Actions で必要な設定

### Secrets（Settings → Secrets and variables → Actions）

| 名前 | 説明 |
|------|------|
| `AWS_ROLE_TO_ASSUME` | OIDC 用 IAM ロール ARN |

### Variables（同上 → Variables）

| 名前 | 説明 |
|------|------|
| `AWS_REGION` | 例: `ap-northeast-1`（`deploy.yml` の `env.AWS_REGION` で使用） |
| `BACKEND_API_URL_DEV` | dev の API パブリックオリジン。**フロントの `VITE_API_ORIGIN` に必須** |
| `BACKEND_API_URL_PROD` | prod 用（同上） |
| `VITE_COGNITO_DOMAIN_DEV` / `PROD` | Cognito Hosted UI domain |
| `VITE_COGNITO_APP_CLIENT_ID_DEV` / `PROD` | Cognito App client ID |
| `VITE_COGNITO_REDIRECT_URI_DEV` / `PROD` | Cognito callback URL |
| `VITE_COGNITO_LOGOUT_URI_DEV` / `PROD` | Cognito sign-out URL |
| `CLOUDFRONT_DISTRIBUTION_ID_DEV` | 任意 |
| `CLOUDFRONT_DISTRIBUTION_ID_PROD` | 任意 |

> **廃止**: `CHALICE_STAGE`、Chalice への `OPENAI_API_KEY` 注入、API URL を `chalice url` で取得する流れ。

## 6. 手動デプロイ時の例（抜粋）

**バックエンド（ECR のみ）**

```bash
cd backend
docker build -t dmwe-api:local .
# ECR ログイン・tag・push は「DEPLOYMENT.md 1.1」を参照
```

**ECS 等で新タスクを起動したあと**、その URL を `VITE_API_ORIGIN` の元にします。

**dev フロント**

```bash
cd frontend
export VITE_API_ORIGIN=https://your-api-dev.example.com
export VITE_API_PREFIX=/api/v1
npm ci && npm run build
aws s3 sync dist s3://dmwe-frontend-dev --delete
aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"
```

**prod** はバケット・URL・CloudFront ID を prod 用に読み替えてください。
