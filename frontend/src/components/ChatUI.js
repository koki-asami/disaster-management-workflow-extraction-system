import React, { useState, useRef, useEffect } from 'react';
import './ChatUI.css';

function ChatUI({ onSend, history, disabled }) {
    const [message, setMessage] = useState('');
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);
    const [expandedCharts, setExpandedCharts] = useState({});
    const chatMessagesRef = useRef(null);

  // チャット履歴が更新されたら自動スクロール
  useEffect(() => {
    scrollToBottom();
  }, [history]);

  // テキストエリアの高さを自動調整
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  // チャートの展開状態が変わった後にスクロール位置を調整
  useEffect(() => {
    const timer = setTimeout(() => {
      if (chatMessagesRef.current) {
        const isScrolledToBottom = 
          chatMessagesRef.current.scrollHeight - chatMessagesRef.current.clientHeight <= 
          chatMessagesRef.current.scrollTop + 100;
        
        if (isScrolledToBottom) {
          scrollToBottom();
        }
      }
    }, 100); // チャートの展開アニメーションが完了するのを待つ
    
    return () => clearTimeout(timer);
  }, [expandedCharts]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSend(message);
      setMessage('');
    }
  };

  const handleKeyDown = (e) => {
    // Command+Enter (Mac) または Ctrl+Enter (Windows/Linux) でメッセージを送信
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const toggleChart = (index) => {
    setExpandedCharts(prev => ({
      ...prev,
      [index]: !prev[index]
    }));
  };

  return (
    <div className="chat-container">
      <h2>チャット</h2>
      <div className="chat-messages" ref={chatMessagesRef}>
        {history.length === 0 ? (
          <div className="chat-placeholder">
            <p>PDFをアップロードするとチャットが開始されます</p>
          </div>
        ) : (
          history.map((msg, index) => (
            <div key={index} className={`chat-message ${msg.role}`}>
              <div className="message-header">
                {msg.role === 'user' ? 'あなた' : 'アシスタント'}
              </div>
              <div className="message-content">
                {msg.content.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
                
                {msg.role === 'assistant' && msg.chart && (
                  <div className="chart-code-container">
                    <button 
                      className="toggle-chart-button"
                      onClick={() => toggleChart(index)}
                    >
                      {expandedCharts[index] ? '▼ Mermaidコードを隠す' : '▶ Mermaidコードを表示'}
                    </button>
                    
                    {expandedCharts[index] && (
                      <pre className="chart-code">
                        <code>{msg.chart}</code>
                      </pre>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>
      <form onSubmit={handleSubmit} className="chat-input-form">
        <textarea
          ref={textareaRef}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="メッセージを入力..."
          disabled={disabled}
          rows={1}
        />
        <button type="submit" disabled={!message.trim() || disabled}>
          送信
        </button>
      </form>
    </div>
  );
}

export default ChatUI;