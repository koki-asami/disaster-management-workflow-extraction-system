# AWS デプロイ手順

本ドキュメントでは、Disaster Management Workflow Extraction System を AWS 上にデプロイする手順（手動デプロイと CI/CD）を説明します。

- **バックエンド**: FastAPI を **コンテナ（Docker）** で動かし、イメージを **ECR** に置き、**ECS / App Runner** 等で起動する想定です（Chalice は使用しません）。
- **非同期抽出ワーカー**（任意）: **SQS → Lambda**（ハンドラ `worker_handler.handler`）。
- **フロントエンド**: **Vite ビルド → `frontend/dist`** を **S3 + CloudFront** で配信。

デプロイに必要な AWS リソースの整理は [AWS_RESOURCES.md](AWS_RESOURCES.md)、環境変数対応は [ENV_MAPPING.md](ENV_MAPPING.md) を参照してください。

---

## 前提条件

- AWS CLI がインストール・設定済み（`aws configure` または環境変数で認証）
- デプロイ先アカウントに必要な IAM 権限
- dev/prod 用の **フロント用 S3 バケット**・**CloudFront** を用意済み（[AWS_RESOURCES.md](AWS_RESOURCES.md)）
- API を載せる **ECR リポジトリ**（例: `dmwe-api-dev` / `dmwe-api-prod`）と、実際にコンテナを動かす **ECS サービスまたは App Runner サービス**（手動または IaC で作成）

---

## 1. 手動デプロイ

### 1.1 バックエンド（Docker / ECR）

1. **backend に移動**

   ```bash
   cd backend
   ```

2. **依存関係（ローカル検証用）**

   ```bash
   uv sync
   ```

3. **イメージのビルド**

   ```bash
   docker build -t dmwe-api:local .
   ```

4. **ECR へプッシュ（例）**

   ```bash
   AWS_REGION=ap-northeast-1
   ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
   REGISTRY="${ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"
   REPO=dmwe-api-dev   # prod では dmwe-api-prod など

   aws ecr describe-repositories --repository-names "$REPO" 2>/dev/null \
     || aws ecr create-repository --repository-name "$REPO"

   aws ecr get-login-password --region "$AWS_REGION" \
     | docker login --username AWS --password-stdin "$REGISTRY"

   docker tag dmwe-api:local "${REGISTRY}/${REPO}:latest"
   docker push "${REGISTRY}/${REPO}:latest"
   ```

5. **実行時の環境変数**

   ECS タスク定義・App Runner・ローカル `docker run` いずれでも、少なくとも次を設定します。

   - `OPENAI_API_KEY`
   - `FLOWCHART_TABLE_NAME`（例: `flowcharts_dev` / `flowcharts_prod`）
   - `S3_BUCKET_NAME`（バックエンド用 PDF バケット。未設定時はコードデフォルト）
   - `EXTRACTION_MODE=batch`（本番標準。ローカル smoke のみ `sync`）
   - `COGNITO_REGION`, `COGNITO_USER_POOL_ID`, `COGNITO_APP_CLIENT_ID`
   - 非同期ジョブを Lambda+SQS で動かす場合: API 側 Lambda/タスクに `EXTRACTION_QUEUE_URL`、ワーカー Lambda に同キューと同一の DynamoDB/S3 権限

   コンテナの既定コマンドは `uvicorn dmwe_api.main:app --host 0.0.0.0 --port 8000`（[backend/Dockerfile](https://github.com/koki-asami/disaster-management-workflow-extraction-system/blob/main/backend/Dockerfile)）。

   API コンテナは HTTP API と SQS enqueue を担当します。PDF 抽出と OpenAI Batch の submit/poll/result merge は SQS ワーカー側に分離して運用します。

6. **パブリック URL**

   ALB / App Runner の URL や API Gateway（自己構成の場合）の**オリジン**（例: `https://api.example.com`、**末尾スラッシュなし**）を決め、フロントのビルドで `VITE_API_ORIGIN` に使います。

### 1.2 非同期ワーカー Lambda（任意）

- **ハンドラ**: `worker_handler.handler`（モジュール `worker_handler` は `backend` を PYTHONPATH に含むパッケージとすること）
- **トリガー**: `EXTRACTION_QUEUE_URL` の SQS キュー
- **環境変数**: API タスクと同様に OpenAI・DynamoDB・S3・テーブル名・`EXTRACTION_MODE=batch` など

権限の目安: [backend/.chalice/lambda_policy.json](../backend/.chalice/lambda_policy.json) および DynamoDB 用ポリシーを参考に、ワーカー用ロールを作成してください。

### 1.3 フロントエンド（S3 + CloudFront）

1. **frontend に移動**

   ```bash
   cd frontend
   ```

2. **依存関係**

   ```bash
   npm ci
   ```

3. **API オリジンを指定してビルド（Vite）**

   バックエンドのパブリックオリジン（**末尾スラッシュなし**）とプレフィックスを渡します。

   **dev 例:**

   ```bash
   export VITE_API_ORIGIN=https://api-dev.example.com
   export VITE_API_PREFIX=/api/v1
   npm run build
   ```

   **prod 例:**

   ```bash
   export VITE_API_ORIGIN=https://api.example.com
   export VITE_API_PREFIX=/api/v1
   npm run build
   ```

   成果物は **`dist/`** です（CRA の `build/` ではありません）。

4. **S3 へ同期**

   ```bash
   aws s3 sync dist s3://dmwe-frontend-dev --delete
   # prod: dmwe-frontend-prod
   ```

5. **CloudFront の無効化（任意）**

   ```bash
   aws cloudfront create-invalidation --distribution-id <ディストリビューションID> --paths "/*"
   ```

---

## 2. CI/CD（GitHub Actions）

### 2.1 概要

- **トリガー**: `main` へ push → **dev**; `v*` タグ → **prod**
- **バックエンド**: `backend/Dockerfile` をビルドし、**ECR** `dmwe-api-dev` / `dmwe-api-prod` へ push（`.github/workflows/deploy.yml`）
- **フロントエンド**: Variables で渡した **API オリジン**で `VITE_*` を設定してビルド → S3 同期 → CloudFront 無効化

ワークフローは **コンテナを ECS 等に自動デプロイしません**。ECR にイメージを入れたあと、**サービスの更新（新イメージのデプロイ）は別途**（コンソール、CDK、Terraform など）が必要です。

### 2.2 初回設定（GitHub と AWS）

#### A. AWS: GitHub を IdP とする OIDC プロバイダー（1 アカウントで 1 回）

1. **IAM** → **ID プロバイダー** → **プロバイダーを追加**
2. **タイプ**: OpenID Connect / **URL**: `https://token.actions.githubusercontent.com` / **オーディエンス**: `sts.amazonaws.com`

既に同じ URL のプロバイダーがあれば省略します。

#### B. GitHub Actions 用 IAM ロール

1. **信頼ポリシー**（カスタム信頼）の例。`YOUR_GITHUB_ORG` / `YOUR_REPO` / `YOUR_AWS_ACCOUNT_ID` を置換してください。

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Principal": {
           "Federated": "arn:aws:iam::YOUR_AWS_ACCOUNT_ID:oidc-provider/token.actions.githubusercontent.com"
         },
         "Action": "sts:AssumeRoleWithWebIdentity",
         "Condition": {
           "StringEquals": {
             "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
           },
           "StringLike": {
             "token.actions.githubusercontent.com:sub": [
               "repo:YOUR_GITHUB_ORG/YOUR_REPO:ref:refs/heads/main",
               "repo:YOUR_GITHUB_ORG/YOUR_REPO:ref:refs/tags/v*"
             ]
           }
         }
       }
     ]
   }
   ```

2. **許可ポリシー**（許可する API の一覧）:

- **ECR**: `GetAuthorizationToken`（Resource は `*` のみ許可）、および対象リポジトリへの `BatchCheckLayerAvailability`, `GetDownloadUrlForLayer`, `BatchGetImage`, `PutImage`, `InitiateLayerUpload`, `UploadLayerPart`, `CompleteLayerUpload`
- **S3**: フロント用バケットへの `PutObject`, `DeleteObject`, `GetObject`, `ListBucket`（`aws s3 sync --delete` でオブジェクト削除に `DeleteObject` が必要）
- **CloudFront**: `CreateInvalidation`（キャッシュ無効化を Actions で行う場合）

**許可ポリシー JSON の例（コピー用）** — リポジトリの `.github/workflows/deploy.yml` 相当の操作に絞った構成です。次を置換してください: `ACCOUNT_ID`、`REGION`（例: `ap-northeast-1`）、フロントバケット名、`DEV_DIST_ID` / `PROD_DIST_ID`（CloudFront を使わない場合は該当 **Statement ごと削除**）。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ECRGetAuthToken",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "ECRPushDmweApi",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload"
      ],
      "Resource": [
        "arn:aws:ecr:REGION:ACCOUNT_ID:repository/dmwe-api-dev",
        "arn:aws:ecr:REGION:ACCOUNT_ID:repository/dmwe-api-prod"
      ]
    },
    {
      "Sid": "FrontendS3Sync",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:GetObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::dmwe-frontend-dev",
        "arn:aws:s3:::dmwe-frontend-dev/*",
        "arn:aws:s3:::dmwe-frontend-prod",
        "arn:aws:s3:::dmwe-frontend-prod/*"
      ]
    },
    {
      "Sid": "CloudFrontInvalidate",
      "Effect": "Allow",
      "Action": "cloudfront:CreateInvalidation",
      "Resource": [
        "arn:aws:cloudfront::ACCOUNT_ID:distribution/DEV_DIST_ID",
        "arn:aws:cloudfront::ACCOUNT_ID:distribution/PROD_DIST_ID"
      ]
    }
  ]
}
```

- ECR リポジトリをまだ作っていない場合は、**手動で作成**するか、ポリシーに `ecr:CreateRepository`（Resource `*`）を追加してください（運用方針に応じて最小化すること）。
- バケット名を `deploy.yml` で変えている場合は **Resource をその名前に合わせる**こと。

Chalice 用の CloudFormation フル権限は**不要**です（Actions から ECS タスク定義やサービス更新まで自動化する場合は、**その操作に必要な権限を別ポリシーで追加**してください）。

3. ロール ARN を GitHub Secret **`AWS_ROLE_TO_ASSUME`** に登録します。

#### C. GitHub リポジトリの設定

**Secrets**

| 名前 | 説明 |
|------|------|
| `AWS_ROLE_TO_ASSUME` | 上記 OIDC ロールの ARN |

**Variables**

| 名前 | 説明 |
|------|------|
| `AWS_REGION` | 例: `ap-northeast-1` |
| `BACKEND_API_URL_DEV` | dev の API パブリックオリジン（末尾スラッシュなし）。フロントの `VITE_API_ORIGIN` に使う |
| `BACKEND_API_URL_PROD` | prod 用（同上） |
| `CLOUDFRONT_DISTRIBUTION_ID_DEV` | 任意。未設定なら無効化ステップはスキップ |
| `CLOUDFRONT_DISTRIBUTION_ID_PROD` | 同上 |

> 以前の `OPENAI_API_KEY` を Chalice の `config.json` に流し込むステップは**廃止**しました。本番の API キーは **ECS / App Runner / Secrets Manager** 側で設定してください。

### 2.3 デプロイの実行

- dev: `main` に merge / push
- prod: `git tag v1.0.0 && git push origin v1.0.0`

Actions の **backend** ジョブ完了後、**ECR 上の `:latest` を参照する ECS サービス等を更新**して API を入れ替えてください。

---

## 3. トラブルシューティング

- **`VITE_API_ORIGIN is empty`（GitHub Actions）**
  `BACKEND_API_URL_DEV` / `BACKEND_API_URL_PROD` が未設定です。フロントはビルド時に API の URL が必要です。

- **フロントから API に繋がらない**
  `VITE_API_ORIGIN` と実際の API のオリジンが一致しているか、CORS（FastAPI で許可オリジン）を確認してください。パスは `VITE_API_PREFIX`（通常 `/api/v1`）です。

- **同期 `/api/v1/analyze_pdf` がタイムアウト**
  ALB のアイドルタイムアウトや API Gateway の統合タイムアウトを確認してください。長時間になる場合は **`POST /api/v1/extractions`** → **`GET /api/v1/extractions/{job_id}`** を使うとクライアントは短時間で応答を受け取れます。

- **S3 sync で Access Denied**
  OIDC ロールに対象バケットの `s3:PutObject` 等があるか確認してください。

- **ECR push で拒否**
  リポジトリ `dmwe-api-dev` / `dmwe-api-prod` が存在するか、ロールに ECR プッシュ権限があるか確認してください。

---

## 4. 長時間処理とタイムアウト

- **Lambda ベースのワーカー**（SQS 経由）は **最大 15 分**まで実行可能です。`worker_handler` のタイムアウトはコンソールまたは IaC で十分な値にしてください。
- **コンテナ（ECS / App Runner）** 上の FastAPI は、プラットフォームの **アイドルタイムアウト**と**クライアントの読み取りタイムアウト**に依存します。数分以上かかる同期処理は **`/extractions` 非同期**に寄せるのが安全です。
- **API Gateway** をコンテナ前段にそのまま置く場合、統合タイムアウト **29 秒**制約があります（クォータ引き上げと統合設定が必要）。ALB 経由なら別の上限設定が適用されます。

---

## 5. レガシー（Chalice）について

以前の **Chalice + `chalice deploy`** 手順は廃止済みです。`.chalice/` に残っている JSON は **IAM ポリシーの参考**として利用できます。新規デプロイは本ドキュメントの **Docker + ECR** 流れに従ってください。
