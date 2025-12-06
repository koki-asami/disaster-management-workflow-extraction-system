# 環境構築
```bash
$ cd backend
$ python3 -m venv venv
$ source venv/bin/activate
$ pip install -r requirements.txt
```
# 環境変数の設定
```bash
$ cp .env.example .env
```

# 実行
```bash
$ chalice local --port 8081 --no-autoreload
```