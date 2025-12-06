フロントエンド（React）実行手順

## 前提条件
- Node.js 18 以上（推奨: 18 LTS）/ npm がインストール済み
- バックエンドが `http://localhost:8081` で起動できること（デフォルト想定）

バージョン確認:

```bash
node -v
npm -v
```

## 初回セットアップ

```bash
cd frontend
npm install
```

（高速・再現性重視の場合は `npm ci` でも可）

## 環境変数（バックエンドのURL）
フロントエンドは `REACT_APP_API_ENDPOINT` を参照します。未設定時は `http://localhost:8081` を使用します。接続先を変えたい場合は `frontend` ディレクトリ直下に `.env.local` を作成してください。

```bash
# frontend/.env.local の例
REACT_APP_API_ENDPOINT=http://localhost:8081

# ポートを変えたい場合（任意）
PORT=3000
```

## 開発サーバーの起動

```bash
npm start
```

ブラウザで `http://localhost:3000` を開きます。

## 本番ビルド

```bash
npm run build
```

`frontend/build` に静的ファイルが出力されます。任意の静的サーバー（例: `npx serve build`）で配信してください。

## よくあるトラブル
- バックエンドに繋がらない: `.env.local` の `REACT_APP_API_ENDPOINT` を正しいURLに設定し、バックエンドが起動しているか確認してください。
- ポート競合で起動できない: `.env.local` に `PORT=3001` など別ポートを指定してください。
- 依存関係エラー: `rm -rf node_modules package-lock.json && npm install` を試してください。

## 主要コマンド
- 開発起動: `npm start`
- 本番ビルド: `npm run build`
- テスト: `npm test`

