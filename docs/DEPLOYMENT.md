# AWS デプロイ手順

本ドキュメントでは、Disaster Management Workflow Extraction System を AWS 上にデプロイする手順（手動デプロイと CI/CD）を説明します。

- **手動デプロイ**: ローカルから AWS CLI と Chalice を使ってデプロイする方法
- **CI/CD**: GitHub Actions による main / タグ push での自動デプロイ

デプロイに必要な AWS リソースの一覧は [AWS_RESOURCES.md](AWS_RESOURCES.md)、環境ごとの変数対応は [ENV_MAPPING.md](ENV_MAPPING.md) を参照してください。

---

## 前提条件

- AWS CLI がインストール・設定済み（`aws configure` または環境変数で認証情報を設定）
- デプロイ先の AWS アカウントに、必要な IAM 権限があること
- （dev/prod 用）S3 バケット・CloudFront ディストリビューションを事前に作成済みであること（[AWS_RESOURCES.md](AWS_RESOURCES.md) 参照）

---

## 1. 手動デプロイ

### 1.1 バックエンド（Chalice）

1. **リポジトリルートで backend に移動**

   ```bash
   cd backend
   ```

2. **依存関係のインストール（uv 利用時）**

   ```bash
   uv sync
   ```

3. **環境変数・API キーの確認**

   - `backend/.chalice/config.json` の対象ステージ（`dev` または `prod`）の `environment_variables` で、少なくとも以下を確認・編集する:
     - `OPENAI_API_KEY`: 有効な OpenAI API キー
     - `FLOWCHART_TABLE_NAME`: dev の場合は `flowcharts_dev`、prod の場合は `flowcharts_prod`
   - バックエンド用 S3 バケット（PDF 保存先）を使い分ける場合は、Lambda の環境変数で `S3_BUCKET_NAME` を設定する（Chalice の `config.json` に追加するか、デプロイ後の Lambda コンソールで設定）。未設定時はデフォルトの `disaster-management-pdfs` が使われます。

4. **デプロイ実行**

   **dev 環境へデプロイ:**

   ```bash
   uv run chalice deploy --stage dev
   ```

   **prod 環境へデプロイ:**

   ```bash
   uv run chalice deploy --stage prod
   ```

5. **出力のメモ**

   デプロイ完了後、ターミナルに次のような行が表示されます:

   ```
   Rest API URL: https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/api/
   ```

   この URL（末尾のスラッシュは除いても可）を、フロントエンドのビルド時に `REACT_APP_API_ENDPOINT` として使います。

### 1.2 フロントエンド（S3 + CloudFront）

1. **リポジトリルートで frontend に移動**

   ```bash
   cd frontend
   ```

2. **依存関係のインストール**

   ```bash
   npm install
   # または npm ci
   ```

3. **API エンドポイントを指定してビルド**

   - 手動デプロイの場合は、バックエンドをデプロイした環境の API Gateway URL を指定する。

   **dev 用にビルド（例）:**

   ```bash
   export REACT_APP_API_ENDPOINT=https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/api
   npm run build
   ```

   **prod 用にビルド（例）:**

   ```bash
   export REACT_APP_API_ENDPOINT=https://yyyyyyyyyy.execute-api.ap-northeast-1.amazonaws.com/api
   npm run build
   ```

   - `REACT_APP_API_ENDPOINT` はビルド時に埋め込まれるため、環境ごとに上記のように切り替えてから `npm run build` を実行する。

4. **S3 へアップロード**

   **dev 用バケットへ同期:**

   ```bash
   aws s3 sync build s3://dmwe-frontend-dev --delete
   ```

   **prod 用バケットへ同期:**

   ```bash
   aws s3 sync build s3://dmwe-frontend-prod --delete
   ```

   - バケット名は [ENV_MAPPING.md](ENV_MAPPING.md) のとおり。別名で作成している場合はそのバケット名に読み替える。

5. **CloudFront キャッシュの無効化（任意）**

   反映をすぐにしたい場合:

   ```bash
   aws cloudfront create-invalidation --distribution-id <ディストリビューションID> --paths "/*"
   ```

   - dev 用・prod 用でそれぞれの CloudFront ディストリビューション ID を指定する。

---

## 2. CI/CD（GitHub Actions）での自動デプロイ

### 2.1 概要

- **トリガー**
  - `main` ブランチへの push → **dev** 環境へデプロイ
  - `v*` 形式のタグ（例: `v1.0.0`）への push → **prod** 環境へデプロイ
- **処理内容**
  1. バックエンド: Chalice で Lambda + API Gateway にデプロイし、出力された API URL を次のジョブに渡す
  2. フロントエンド: 上記 API URL を `REACT_APP_API_ENDPOINT` に設定してビルドし、S3 へ同期・CloudFront の無効化を実行

ワークフロー定義: [../.github/workflows/deploy.yml](../.github/workflows/deploy.yml)

### 2.2 初回設定（GitHub と AWS）

#### A. AWS: GitHub を IdP とする OIDC プロバイダーを作成（1 アカウントで 1 回）

1. **AWS マネジメントコンソール** にログインし、**IAM** を開く。
2. 左メニューで **「ID プロバイダー」**（Identity providers）を選ぶ。
3. **「プロバイダーを追加」**（Add provider）をクリック。
4. 次を設定する:
   - **プロバイダータイプ**: OpenID Connect
   - **プロバイダー URL**: `https://token.actions.githubusercontent.com`
   - **オーディエンス**（Audience）: `sts.amazonaws.com`
5. **「プロバイダーを追加」** をクリックして保存する。

> プロバイダー名は自動で `token.actions.githubusercontent.com` になる。同じ URL のプロバイダーが既にあれば、この手順は不要。

#### B. AWS: GitHub Actions が Assume する IAM ロールを作成

1. IAM の **「ロール」**（Roles）→ **「ロールを作成」**（Create role）。
2. **信頼されたエンティティタイプ**: カスタム信頼ポリシー（Custom trust policy）を選ぶ。
3. **信頼ポリシー**（JSON）に以下を貼り付ける。`YOUR_GITHUB_ORG` と `YOUR_REPO` を実際の GitHub の組織名・リポジトリ名に置き換える。

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

   - `YOUR_AWS_ACCOUNT_ID`: 12 桁の AWS アカウント ID（IAM の「ダッシュボード」などで確認可能）。
   - 上記の `sub` で、`main` ブランチと `v*` タグからのみ Assume を許可している。
4. **「次へ」** を押し、**許可ポリシー** をアタッチする。必要な権限の例:
   - **Chalice デプロイ用**: `AWSLambda_FullAccess`、`AmazonAPIGatewayAdministrator`、`IAMFullAccess`（またはより絞ったカスタムポリシー）、`AmazonS3FullAccess`（または対象バケットのみ）、`CloudFrontFullAccess`（または CreateInvalidation のみ）など。  
   - 最小限にしたい場合は、[GitHub の公式ドキュメント](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/configuring-openid-connect-in-amazon-web-services) や [AWS ブログ](https://aws.amazon.com/blogs/security/use-iam-roles-to-connect-github-actions-to-actions-in-aws/) のポリシー例を参照。
5. ロール名を入力（例: `github-actions-deploy`。ロール名に "github" を含めると問題が出る場合があるため、`gh-oidc-deploy` などでも可）して **「ロールを作成」**。
6. 作成したロールを開き、**ARN**（例: `arn:aws:iam::123456789012:role/github-actions-deploy`）をコピーする。これを GitHub の Secret **`AWS_ROLE_TO_ASSUME`** に登録する。

#### C. GitHub リポジトリの設定

- **Secrets**（Settings → Secrets and variables → Actions）:
  - `AWS_ROLE_TO_ASSUME`: 上記 IAM ロールの ARN
  - `OPENAI_API_KEY`: （推奨）OpenAI API キー。ワークフローで Chalice の config に注入される
   - **Variables**（同上 → Variables）:
  - `CLOUDFRONT_DISTRIBUTION_ID_DEV`: dev 用 CloudFront ディストリビューション ID
  - `CLOUDFRONT_DISTRIBUTION_ID_PROD`: prod 用 CloudFront ディストリビューション ID

#### D. S3・CloudFront の事前作成

- [AWS_RESOURCES.md](AWS_RESOURCES.md) に従い、dev/prod 用の S3 バケットと CloudFront ディストリビューションを作成しておく。Variables には、作成後に取得したディストリビューション ID を設定する。

### 2.3 デプロイの実行

- **dev へデプロイ:** `main` に push する（例: マージ後）
- **prod へデプロイ:** タグを push する（例: `git tag v1.0.0 && git push origin v1.0.0`）

Actions タブでワークフローの実行状況とログを確認できます。

---

## 3. トラブルシューティング

- **Chalice デプロイで権限エラー**
  - 使用している IAM ユーザーまたは OIDC ロールに、Lambda / API Gateway / IAM / CloudFormation 等の権限があるか確認する。
- **フロントのビルドで API に繋がらない**
  - デプロイ先の API Gateway URL と、ビルド時に指定した `REACT_APP_API_ENDPOINT` が一致しているか確認する。CORS は Chalice 側で `allow_origin='*'` になっているため、同一ドメインでなくても API は呼び出せる想定。
- **S3 sync で Access Denied**
  - 対象バケットに対する `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` 等の権限があるか確認する。
- **CloudFront の無効化がスキップされる**
  - GitHub の Variables に `CLOUDFRONT_DISTRIBUTION_ID_DEV` / `CLOUDFRONT_DISTRIBUTION_ID_PROD` が設定されていれば実行される。未設定の場合はステップがスキップされ、S3 同期のみ行われる。

その他、DynamoDB テーブル名やバックエンド用 S3 バケット名の対応は [ENV_MAPPING.md](ENV_MAPPING.md) を参照してください。

---

## 4. 長時間処理（約 10 分）と Lambda / API Gateway

処理に **10 分程度** かかる場合の注意点です。

### 4.1 Lambda について

- **10 分は問題ありません。** AWS Lambda の最大タイムアウトは **15 分（900 秒）** です。
- 本プロジェクトでは `.chalice/config.json` の各ステージに **`lambda_timeout`: 600**（10 分）を設定しています。必要なら 900 に変更できます。
- 15 分を超える処理には Lambda は向かないため、その場合は Step Functions・ECS Fargate・SQS ワーカーなどの構成を検討してください。

### 4.2 API Gateway のタイムアウト（同期レスポンスで重要）

**同期で** 10 分待つエンドポイント（例: `POST /analyze_pdf`）を使う場合、次が重要です。

- API Gateway の **統合タイムアウト** のデフォルトは **29 秒** です。
- 29 秒を超えると、Lambda が動いていても **504 Gateway Timeout** が返り、クライアントは結果を受け取れません。
- **対処法は次のいずれかです。**

1. **API Gateway のタイムアウトを延長する（同期のまま使う場合）**  
   - AWS の **Service Quotas** で「Amazon API Gateway」の **Maximum integration timeout in milliseconds** の引き上げをリクエスト（例: 10 分 = 600,000 ms）。  
   - 承認後、API Gateway コンソールで該当 API の「統合リクエスト」の **統合タイムアウト** を 600 秒などに設定し、API を再デプロイする。  
   - Chalice は統合タイムアウトを config で指定できないため、**手動で API Gateway 側を変更**する必要があります。

2. **非同期フローを使う（推奨）**  
   - 長時間の PDF 抽出には、すでに実装されている **`POST /extractions`**（即座に 202 と `job_id` を返す）→ **`GET /extractions/{job_id}`** でポーリングする流れを使う。  
   - リクエストは短時間で返るため、API Gateway の 29 秒制限の影響を受けません。Lambda 側は最大 15 分まで実行できます。

まとめると、**Lambda は 10 分の処理に適しています**。同期の `/analyze_pdf` を 10 分まで待たせる場合は API Gateway の統合タイムアウト延長が必要で、非同期の `/extractions` を使う場合はそのままで問題ありません。
