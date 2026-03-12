# 環境変数マッピング（dev / prod）

CI/CD（GitHub Actions）および手動デプロイ時に参照する、環境ごとの変数一覧です。

## 1. デプロイ先の切り替え

| トリガー | デプロイ先 |
|----------|------------|
| `main` ブランチへの push | **dev** |
| `v*` タグへの push（例: `v1.0.0`） | **prod** |

## 2. バックエンド（Chalice）関連

| 変数名 | dev | prod | 備考 |
|--------|-----|------|------|
| `CHALICE_STAGE` | `dev` | `prod` | `chalice deploy --stage` に渡す値 |
| API Gateway URL（出力） | 例: `https://xxxx.execute-api.ap-northeast-1.amazonaws.com/api` | 別 API ID の同形式 URL | デプロイ後に Chalice が表示。フロントの `REACT_APP_API_ENDPOINT` に渡す |
| `FLOWCHART_TABLE_NAME` | `flowcharts_dev` | `flowcharts_prod` | `.chalice/config.json` の `environment_variables` で定義済み |
| `S3_BUCKET_NAME`（バックエンド用） | `dmwe-pdfs-dev` | `dmwe-pdfs-prod` | PDF・チャート保存用。未設定時はデフォルト `disaster-management-pdfs` |
| `OPENAI_API_KEY` | GitHub Secrets または AWS で設定 | 同上 | CI では Secrets の `OPENAI_API_KEY` を config に注入 |

## 3. フロントエンド（S3 + CloudFront）関連

| 変数名 | dev | prod | 備考 |
|--------|-----|------|------|
| `REACT_APP_API_ENDPOINT` | dev の API Gateway URL（末尾スラッシュなし） | prod の API Gateway URL | ビルド時に埋め込み。CI では backend ジョブの出力から取得 |
| `FRONTEND_BUCKET` | `dmwe-frontend-dev` | `dmwe-frontend-prod` | `aws s3 sync` の対象バケット |
| `CLOUDFRONT_DISTRIBUTION_ID` | dev 用 CloudFront の ID | prod 用 CloudFront の ID | GitHub の **Variables** に設定: `CLOUDFRONT_DISTRIBUTION_ID_DEV`, `CLOUDFRONT_DISTRIBUTION_ID_PROD` |

## 4. GitHub Actions で必要な設定

### Secrets（リポジトリ設定 → Secrets and variables → Actions）

| 名前 | 説明 |
|------|------|
| `AWS_ROLE_TO_ASSUME` | OIDC で Assume する IAM ロールの ARN（例: `arn:aws:iam::123456789012:role/github-actions-deploy`） |
| `OPENAI_API_KEY` | OpenAI API キー。Chalice デプロイ時に config の `YOUR_OPENAI_API_KEY_HERE` を置換するために使用（任意だが本番では推奨） |

### Variables（リポジトリ設定 → Variables）

| 名前 | 説明 |
|------|------|
| `CLOUDFRONT_DISTRIBUTION_ID_DEV` | dev 用 CloudFront ディストリビューション ID |
| `CLOUDFRONT_DISTRIBUTION_ID_PROD` | prod 用 CloudFront ディストリビューション ID |

- バケット名（`dmwe-frontend-dev` / `dmwe-frontend-prod`）はワークフロー内で固定のため、Variables には不要です。
- 初回デプロイで CloudFront をまだ作っていない場合は、上記 Variables を空のままにすると「Invalidate CloudFront cache」ステップはスキップされます（S3 同期は実行されます）。

## 5. 手動デプロイ時の例

**dev バックエンド**

```bash
cd backend
export CHALICE_STAGE=dev
# 必要なら .chalice/config.json の OPENAI_API_KEY を編集
uv run chalice deploy --stage $CHALICE_STAGE
# 表示された Rest API URL をメモ
```

**dev フロントエンド**

```bash
cd frontend
export REACT_APP_API_ENDPOINT=https://xxxx.execute-api.ap-northeast-1.amazonaws.com/api
npm run build
aws s3 sync build s3://dmwe-frontend-dev --delete
aws cloudfront create-invalidation --distribution-id <CLOUDFRONT_ID_DEV> --paths "/*"
```

**prod** の場合は `CHALICE_STAGE=prod`、`dmwe-frontend-prod`、prod 用 CloudFront ID に読み替えてください。
