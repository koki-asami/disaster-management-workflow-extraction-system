# Disaster Management Workflow Extraction System

## 概要
PDF資料から防災計画のワークフローを抽出し、可視化するシステムです。

## 環境構築

### 必須要件
- Node.js (v18推奨)
- Python (v3.9推奨)
- AWS CLI (設定済みであること)

### セットアップ手順

1. リポジトリのクローン
```bash
git clone https://github.com/koki-asami/disaster-management-workflow-extraction-system.git
cd disaster-management-workflow-extraction-system
```

2. バックエンドの設定
```bash
cd backend
# 仮想環境の作成と有効化
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 依存関係のインストール
pip install -r requirements.txt
```

**重要: APIキーの設定**
`backend/.chalice/config.json` を開き、`YOUR_OPENAI_API_KEY_HERE` の部分をご自身の OpenAI API キーに書き換えてください。

```json
"environment_variables": {
  "OPENAI_API_KEY": "sk-...", 
  "FLOWCHART_TABLE_NAME": "flowcharts_dev"
}
```

3. フロントエンドの設定
```bash
cd ../frontend
npm install
```

### 実行方法

1. バックエンドの起動（別ターミナルで）
```bash
cd backend
chalice local --port 8081
```

2. フロントエンドの起動（別ターミナルで）
```bash
cd frontend
npm start
```

ブラウザで `http://localhost:3000` にアクセスしてください。
