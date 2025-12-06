import React, { useState, useRef, useEffect } from 'react';
import './ChatUI.css';

function ChatUI({ onSend, history, disabled }) {
    const [message, setMessage] = useState('');
    const messagesEndRef = useRef(null);
    const textareaRef = useRef(null);
    const [expandedCharts, setExpandedCharts] = useState({});
    const chatMessagesRef = useRef(null);

  // Auto-scroll when chat history updates
  useEffect(() => {
    scrollToBottom();
  }, [history]);

  // Auto-adjust textarea height
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 150)}px`;
    }
  }, [message]);

  // Adjust scroll position after chart expansion state changes
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
    }, 100); // Wait for chart expansion animation to complete
    
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
    // Send message with Command+Enter (Mac) or Ctrl+Enter (Windows/Linux)
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
      <h2>Chat</h2>
      <div className="chat-messages" ref={chatMessagesRef}>
        {history.length === 0 ? (
          <div className="chat-placeholder">
            <p>Chat will start when you upload a PDF</p>
          </div>
        ) : (
          history.map((msg, index) => (
            <div key={index} className={`chat-message ${msg.role}`}>
              <div className="message-header">
                {msg.role === 'user' ? 'You' : 'Assistant'}
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
                      {expandedCharts[index] ? '▼ Hide Mermaid Code' : '▶ Show Mermaid Code'}
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
          placeholder="Enter your message..."
          disabled={disabled}
          rows={1}
        />
        <button type="submit" disabled={!message.trim() || disabled}>
          Send
        </button>
      </form>
    </div>
  );
}

export default ChatUI;