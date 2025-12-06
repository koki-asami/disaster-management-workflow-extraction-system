// ログレベルの定義
const LogLevel = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3
  };
  
  // 現在のログレベル（環境変数から取得、デフォルトはINFO）
  const currentLogLevel = process.env.REACT_APP_LOG_LEVEL 
    ? LogLevel[process.env.REACT_APP_LOG_LEVEL.toUpperCase()] 
    : LogLevel.INFO;
  
  // ログ履歴の保存（最大100件）
  const logHistory = [];
  const MAX_LOG_HISTORY = 100;
  
  // タイムスタンプの生成
  const getTimestamp = () => {
    return new Date().toISOString();
  };
  
  // ログメッセージのフォーマット
  const formatLogMessage = (level, message, data) => {
    const timestamp = getTimestamp();
    const formattedMessage = `[${timestamp}] [${level}] ${message}`;
    
    // ログ履歴に追加
    logHistory.push({
      timestamp,
      level,
      message,
      data
    });
    
    // 履歴が最大数を超えたら古いものを削除
    if (logHistory.length > MAX_LOG_HISTORY) {
      logHistory.shift();
    }
    
    return formattedMessage;
  };
  
  // ログ出力関数
  const logger = {
    debug: (message, data) => {
      if (currentLogLevel <= LogLevel.DEBUG) {
        console.debug(formatLogMessage('DEBUG', message, data), data || '');
      }
    },
    
    info: (message, data) => {
      if (currentLogLevel <= LogLevel.INFO) {
        console.info(formatLogMessage('INFO', message, data), data || '');
      }
    },
    
    warn: (message, data) => {
      if (currentLogLevel <= LogLevel.WARN) {
        console.warn(formatLogMessage('WARN', message, data), data || '');
      }
    },
    
    error: (message, error) => {
      if (currentLogLevel <= LogLevel.ERROR) {
        console.error(formatLogMessage('ERROR', message, error), error || '');
      }
    },
    
    // ログ履歴の取得
    getHistory: () => {
      return [...logHistory];
    },
    
    // ログ履歴のクリア
    clearHistory: () => {
      logHistory.length = 0;
    }
  };
  
  export default logger;
  