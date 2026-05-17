import logging
import os
import sys
from datetime import datetime

# ログレベルの設定（環境変数から取得、デフォルトはINFO）
LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()
LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'

# ログディレクトリの作成
log_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'logs')
os.makedirs(log_dir, exist_ok=True)

# 現在の日付をファイル名に使用
current_date = datetime.now().strftime('%Y-%m-%d')
log_file = os.path.join(log_dir, f'app_{current_date}.log')


# ロガーの設定
def setup_logger(name):
    """アプリケーション用のロガーをセットアップする"""
    logger = logging.getLogger(name)

    # ログレベルの設定
    level = getattr(logging, LOG_LEVEL, logging.INFO)
    logger.setLevel(level)

    # ハンドラーがすでに設定されている場合は追加しない
    if logger.handlers:
        return logger

    # コンソールハンドラー
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(console_handler)

    # ファイルハンドラー
    file_handler = logging.FileHandler(log_file)
    file_handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(file_handler)

    return logger


# デフォルトロガーの取得
def get_logger(name='app'):
    """名前付きロガーを取得する"""
    return setup_logger(name)
