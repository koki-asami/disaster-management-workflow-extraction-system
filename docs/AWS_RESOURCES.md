# AWS リソース一覧（デプロイ用）

本ドキュメントは、Disaster Management Workflow Extraction System を AWS 上に dev / prod の2環境でデプロイする際に必要なリソースを整理したものです。

## 概要

| 種別 | dev | prod | 備考 |
|------|-----|------|------|
| バックエンド | Chalice (Lambda + API Gateway) stage: `dev` | Chalice stage: `prod` | `.chalice/config.json` で定義 |
| フロントエンド静的サイト | S3 + CloudFront | S3 + CloudFront | 別バケット・別ディストリビューション |
| DynamoDB | flowcharts_dev 等 | flowcharts_prod 等 | アプリ起動時に自動作成も可 |
| バックエンド用 S3（PDF等） | 1バケット | 1バケット | 環境変数 `S3_BUCKET_NAME` で指定 |
| CI/CD | GitHub Actions → AWS | 同上 | OIDC 用 IAM ロール |

---

## 1. バックエンド（Chalice）

### 1.1 デプロイで自動作成されるリソース

`chalice deploy --stage dev` / `chalice deploy --stage prod` 実行時に Chalice が自動作成します。

| リソース | 説明 |
|----------|------|
| **Lambda 関数** | 名前: `backend-dev` / `backend-prod`。API Gateway から呼び出される。 |
| **API Gateway REST API** | ステージ名: `api`。URL 例: `https://<api-id>.execute-api.ap-northeast-1.amazonaws.com/api/` |
| **IAM ロール** | Lambda 実行用。名前: `backend-dev` / `backend-prod`。ポリシー: `dynamodb_policy.json` + `lambda_policy.json` をアタッチ。 |

### 1.2 事前に用意するリソース（またはアプリ側で自動作成）

#### DynamoDB テーブル

| テーブル名 | 用途 | キー | 備考 |
|------------|------|------|------|
| `flowcharts_dev` | dev 用フローチャート本体 | パーティション: `id` (S) | GSI: LocationTypeIndex, LocationNameIndex |
| `flowcharts_dev_uploads` | dev 用アップロードメタ | パーティション: `upload_id` (S) | 初回アクセス時に `database.py` で自動作成可 |
| `flowcharts_dev_jobs` | dev 用抽出ジョブ | パーティション: `job_id` (S) | 同上 |
| `flowcharts_prod` | prod 用フローチャート本体 | 上記と同様 | |
| `flowcharts_prod_uploads` | prod 用アップロードメタ | 上記と同様 | |
| `flowcharts_prod_jobs` | prod 用抽出ジョブ | 上記と同様 | |

- `config.json` の `FLOWCHART_TABLE_NAME` が `flowcharts_dev` / `flowcharts_prod` になっており、`database.py` は `_uploads` / `_jobs` を接尾辞で作成します。
- テーブルはアプリの初回アクセス時に `_get_or_create_table` で自動作成されるため、手動作成は任意です。手動で作る場合は Provisioned スループット（例: 5/5）またはオンデマンドを指定してください。

#### バックエンド用 S3 バケット（PDF・チャート保存）

| 環境 | バケット名（例） | 用途 |
|------|------------------|------|
| dev | `dmwe-pdfs-dev` | PDF アップロード、チャート JSON、graph_data の保存 |
| prod | `dmwe-pdfs-prod` | 同上 |

- 環境変数 `S3_BUCKET_NAME` で指定。未設定時はデフォルト `disaster-management-pdfs`。
- リージョン: `ap-northeast-1` を推奨（Chalice と同じ）。
- Lambda からアクセスするため、`backend/.chalice/lambda_policy.json` で当該バケットへの s3:GetObject, PutObject, DeleteObject, ListBucket 等を許可すること。

#### （オプション）非同期抽出用 SQS

- 非同期ジョブ（`POST /extractions` → SQS → ワーカー Lambda）を使う場合のみ必要。
- キュー名例: `dmwe-extraction-queue-dev` / `dmwe-extraction-queue-prod`。
- 環境変数: `EXTRACTION_QUEUE_URL` にキュー URL を設定。
- 本一覧では「CI/CD とデプロイ」に必須ではないため、詳細は省略。

---

## 2. フロントエンド（S3 + CloudFront）

### 2.1 S3 バケット

| 環境 | バケット名（例） | 用途 |
|------|------------------|------|
| dev | `dmwe-frontend-dev` | React ビルド成果物（`frontend/build`）のホスティング |
| prod | `dmwe-frontend-prod` | 同上（本番） |

- リージョン: 任意（CloudFront オリジンとするため、同一リージョンでなくても可。東京 `ap-northeast-1` で統一してもよい）。
- パブリックアクセス: バケット自体はブロックのまま、CloudFront 経由のみで配信する構成を推奨（オリジンアクセスコントロール / OAC または OAI で S3 への直アクセスを禁止）。

### 2.2 CloudFront ディストリビューション

| 環境 | 用途 |
|------|------|
| dev | `dmwe-frontend-dev` をオリジンとするディストリビューション。HTTPS で配信。 |
| prod | `dmwe-frontend-prod` をオリジンとするディストリビューション。同上。 |

- 作成後、**ディストリビューション ID** をメモし、CI/CD の `CLOUDFRONT_DISTRIBUTION_ID` に設定する。
- デプロイ時にキャッシュ無効化: `aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"` を実行する想定。

### 2.3 作成手順の要点

1. S3 バケットを作成（例: `dmwe-frontend-dev`, `dmwe-frontend-prod`）。
2. バケットポリシーで CloudFront の OAI/OAC からの GetObject のみ許可。
3. CloudFront ディストリビューションを作成し、オリジンに上記 S3 を指定。必要に応じてカスタムドメイン・ACM 証明書を設定。
4. GitHub Actions では、該当バケットへ `aws s3 sync build s3://<bucket> --delete`、その後 `create-invalidation` を実行。

---

## 3. IAM（Chalice 以外）

### 3.1 Chalice が利用するポリシー（Lambda ロールにアタッチ）

- **dynamodb_policy.json**  
  - DynamoDB の `flowcharts*` テーブルおよびその GSI に対する CreateTable, DescribeTable, GetItem, PutItem, UpdateItem, DeleteItem, Query, Scan, BatchGetItem, BatchWriteItem。
- **lambda_policy.json**  
  - バックエンド用 S3 バケット（`dmwe-pdfs-dev`, `dmwe-pdfs-prod`）に対する GetObject, PutObject, DeleteObject, ListBucket 等。Chalice の `config.json` から参照される。

### 3.2 GitHub Actions 用（OIDC）

- **役割**: GitHub Actions から AWS にデプロイする際に AssumeRole するための IAM ロール。
- **信頼関係**: GitHub OIDC プロバイダー（`token.actions.githubusercontent.com`）を Federated として指定。条件でリポジトリ・ブランチ/タグを制限可能。
- **権限**: 以下ができるようにポリシーを付与する。
  - Chalice デプロイ: Lambda, API Gateway, IAM ロール/ポリシー、CloudFormation 等。
  - フロントエンドデプロイ: 対象 S3 バケットへの s3:PutObject, DeleteObject 等、CloudFront の CreateInvalidation。
- 詳細は [GitHub Actions と OIDC の設定](#github-actions-と-oidc-の設定) を参照。

---

## 4. 環境変数・パラメータの対応表

dev / prod ごとの代表的な値をまとめたものは [docs/ENV_MAPPING.md](ENV_MAPPING.md) を参照してください。  
ここではリソース名と対応関係のみ記載します。

| リソース | dev | prod |
|----------|-----|------|
| Chalice ステージ | `dev` | `prod` |
| API Gateway URL | デプロイ後に出力される URL（例: `https://xxxx.execute-api.ap-northeast-1.amazonaws.com/api`） | 同上（別 API ID） |
| DynamoDB メインテーブル | `flowcharts_dev` | `flowcharts_prod` |
| バックエンド S3 バケット | `dmwe-pdfs-dev` | `dmwe-pdfs-prod` |
| フロント用 S3 バケット | `dmwe-frontend-dev` | `dmwe-frontend-prod` |
| CloudFront ディストリビューション ID | 作成後に取得 | 作成後に取得 |

---

## 5. GitHub Actions と OIDC の設定

1. **AWS 側**
   - GitHub を IdP とする OIDC プロバイダーを作成（1アカウント1回で可）。
   - GitHub Actions 用の IAM ロールを作成し、信頼ポリシーで `token.actions.githubusercontent.com` の Sub が `repo:<org>/<repo>:ref:refs/heads/main` または `refs/tags/v*` のときに AssumeRole を許可。
   - ロールに、Chalice デプロイ・S3 アップロード・CloudFront 無効化に必要な権限を付与したポリシーをアタッチ。
2. **GitHub 側**
   - リポジトリの Settings → Secrets and variables → Actions に、`AWS_ROLE_TO_ASSUME`（OIDC で利用する IAM ロールの ARN）を登録。必要に応じて `OPENAI_API_KEY` 等も Secrets に登録。
3. ワークフローでは `aws-actions/configure-aws-credentials@v4` で `role-to-assume: ${{ secrets.AWS_ROLE_TO_ASSUME }}` を指定して認証する。

---

## 6. チェックリスト（初回デプロイ前）

- [ ] DynamoDB: `flowcharts_dev` / `flowcharts_prod`（および _uploads, _jobs）を手動作成するか、アプリの自動作成に任せるか決定済み。
- [ ] S3: バックエンド用 `dmwe-pdfs-dev`, `dmwe-pdfs-prod` を作成済み。Chalice の `config.json` または環境変数で `S3_BUCKET_NAME` を設定する方針を確認。
- [ ] S3: フロント用 `dmwe-frontend-dev`, `dmwe-frontend-prod` を作成済み。
- [ ] CloudFront: dev / prod 用ディストリビューションを作成し、オリジンに上記 S3 を指定済み。ディストリビューション ID をメモ済み。
- [ ] IAM: `lambda_policy.json` にバックエンド S3 バケットへの権限が含まれていることを確認。
- [ ] IAM: GitHub Actions 用 OIDC ロールを作成し、GitHub の Secrets に `AWS_ROLE_TO_ASSUME` を登録済み。
- [ ] `OPENAI_API_KEY` を Secrets Manager / Parameter Store または GitHub Secrets で用意し、Chalice の環境変数に渡す方法を決定済み。

以上で、デプロイに必要な AWS リソースの一覧と役割の整理は完了です。
