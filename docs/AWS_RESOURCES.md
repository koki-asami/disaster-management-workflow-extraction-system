# AWS リソース一覧（デプロイ用）

Disaster Management Workflow Extraction System を AWS 上に **dev / prod** で載せる際のリソース整理です。**バックエンドは Chalice ではなく、FastAPI をコンテナ（Docker）で実行**します。

## 概要

| 種別 | dev | prod | 備考 |
|------|-----|------|------|
| API（FastAPI） | ECS Fargate / App Runner 等 + **ECR** `dmwe-api-dev` | 同左 `dmwe-api-prod` | `backend/Dockerfile`。Actions は **ECR push まで** |
| 非同期ワーカー（任意） | Lambda（`worker_handler.handler`）+ SQS | 同上 | `POST /api/v1/extractions` が Lambda 上で SQS に投入する構成 |
| フロント | S3 + CloudFront | S3 + CloudFront | 静的ファイルは Vite の **`dist/`** |
| DynamoDB | `flowcharts_dev` 系 | `flowcharts_prod` 系 | `_uploads` / `_jobs` 接尾辞 |
| バックエンド用 S3（PDF 等） | 例: `dmwe-pdfs-dev` | 例: `dmwe-pdfs-prod` | `S3_BUCKET_NAME` |
| CI/CD | GitHub Actions → ECR + S3 | 同上 | OIDC ロール |

---

## 1. バックエンド（コンテナ + ECR）

### 1.1 コンテナイメージ

- **ビルドコンテキスト**: リポジトリの `backend/`（[backend/Dockerfile](../backend/Dockerfile)）
- **プロセス**: `uvicorn dmwe_api.main:app --host 0.0.0.0 --port 8000`
- **CI**: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) が `dmwe-api-<stage>` に **push**（**ECS サービス更新は含まない**）

### 1.2 実行基盤（自分で用意）

次のいずれか（または同等）を想定します。

- **Amazon ECS（Fargate）** + タスク定義で上記イメージ、環境変数・タスクロールを設定
- **App Runner** でソースではなく **ECR イメージ**を指定

**タスク / インスタンスロール**に必要な権限の例:

- DynamoDB: `FLOWCHART_TABLE_NAME` および `*_uploads` / `*_jobs` テーブル・GSI への読み書き
- S3: `S3_BUCKET_NAME` バケットへの Get/Put/List/Delete（用途に応じて）
- （非同期）SQS: `SendMessage`（API がキューに投入する場合）

参考: 旧 Chalice 用の [backend/.chalice/lambda_policy.json](../backend/.chalice/lambda_policy.json) や DynamoDB ポリシーを、**タスクロール用に再構成**してください。

### 1.3 非同期ワーカー Lambda（任意）

| 項目 | 内容 |
|------|------|
| コードエントリ | **`worker_handler.handler`**（[backend/worker_handler.py](../backend/worker_handler.py)） |
| トリガー | `EXTRACTION_QUEUE_URL` の SQS キュー |
| タイムアウト | 長い PDF 処理に合わせ最大 15 分まで（要設定） |

API コンテナと**同じ** DynamoDB・S3・OpenAI 設定を共有します。

---

## 2. DynamoDB

| テーブル名 | 用途 | 備考 |
|------------|------|------|
| `flowcharts_<env>` | フローチャート本体 | GSI: LocationTypeIndex, LocationNameIndex 等 |
| `flowcharts_<env>_uploads` | アップロードメタ | |
| `flowcharts_<env>_jobs` | 抽出ジョブ | |

`database.py` が初回アクセスでテーブル作成する場合があります。本番ではオンデマンドまたはキャパシティを明示することを推奨します。

---

## 3. バックエンド用 S3（PDF・成果 JSON）

| 環境 | バケット名（例） |
|------|------------------|
| dev | `dmwe-pdfs-dev` |
| prod | `dmwe-pdfs-prod` |

環境変数 `S3_BUCKET_NAME`。未設定時はリポジトリ既定のデフォルト名が使われます。

---

## 4. フロントエンド（S3 + CloudFront）

### 4.1 S3 バケット

| 環境 | バケット名（ワークフロー既定） | 格納物 |
|------|-------------------------------|--------|
| dev | `dmwe-frontend-dev` | **`npm run build` → `frontend/dist`** |
| prod | `dmwe-frontend-prod` | 同上 |

### 4.2 CloudFront

- オリジンに上記 S3（OAC / OAI 推奨）
- GitHub Variables: `CLOUDFRONT_DISTRIBUTION_ID_DEV` / `PROD`（任意）

### 4.3 ビルド時環境変数（Vite）

- `VITE_API_ORIGIN`: API のパブリックオリジン（**末尾スラッシュなし**）
- `VITE_API_PREFIX`: 通常 `/api/v1`

---

## 5. IAM（GitHub Actions / OIDC）

1. **ID プロバイダー**: `token.actions.githubusercontent.com`（Aud: `sts.amazonaws.com`）
2. **ロール**: 信頼ポリシーで当該リポジトリの `main` / `v*` から AssumeRole
3. **権限の例**
   - `sts:GetCallerIdentity`（オプション）
   - **ECR**: ログインと `dmwe-api-dev` / `dmwe-api-prod` へのイメージ push
   - **S3**: フロント用バケットへの sync
   - **CloudFront**: `CreateInvalidation`（使う場合）

Chalice デプロイ用の CloudFormation フル権限は **不要**です（IaC で ECS を Actions から更新する場合は別途）。

**GitHub**: Secret `AWS_ROLE_TO_ASSUME`、Variables に `AWS_REGION`, `BACKEND_API_URL_*`, CloudFront ID。詳細は [ENV_MAPPING.md](ENV_MAPPING.md)。

---

## 6. 対応表（早見）

| 項目 | dev | prod |
|------|-----|------|
| ECR リポジトリ | `dmwe-api-dev` | `dmwe-api-prod` |
| API 公開 URL（例） | ALB / App Runner の DNS | 同上 |
| フロント用 S3 | `dmwe-frontend-dev` | `dmwe-frontend-prod` |
| DynamoDB 接頭辞 | `flowcharts_dev` | `flowcharts_prod` |

---

## 7. チェックリスト（初回）

- [ ] ECR に `dmwe-api-dev` / `dmwe-api-prod` を作成（または初回 push で作成する運用を決める）
- [ ] ECS / App Runner で API サービスを定義し、環境変数・secrets・ロールを設定
- [ ] GitHub Variables に `BACKEND_API_URL_DEV` / `PROD`（実際の API オリジン）を設定
- [ ] フロント用 S3・CloudFront・OIDC ロールを用意
- [ ] （非同期）SQS・ワーカー Lambda・API 側 `EXTRACTION_QUEUE_URL` を組み立て

以上です。
