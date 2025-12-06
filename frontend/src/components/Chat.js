import React, { useState, useRef, useEffect, useCallback } from 'react';
import './Chat.css';

function Chat({ onFlowchartUpdate }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [scrollToBottom]);

  const extractMermaidCode = (text) => {
    const mermaidRegex = /```mermaid\s*([\s\S]*?)\s*```/;
    const match = text.match(mermaidRegex);
    return match ? match[1] : null;
  };

  const handleUpdateFlowchart = (mermaidCode) => {
    if (mermaidCode && onFlowchartUpdate) {
      onFlowchartUpdate(mermaidCode);
      // Remove the update buttons from the message
      setMessages(prevMessages => 
        prevMessages.map(msg => 
          msg.id === messages[messages.length - 1].id
            ? { ...msg, showUpdateButtons: false }
            : msg
        )
      );
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage = input.trim();
    setInput('');
    setIsLoading(true);

    // Add user message
    setMessages(prev => [...prev, { 
      id: Date.now(), 
      role: 'user', 
      content: userMessage 
    }]);

    try {
      const response = await fetch('/chat_update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          instruction: userMessage,
          history: messages
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to get response');
      }

      const data = await response.json();
      
      // Extract Mermaid code if present
      const mermaidCode = extractMermaidCode(data.message);
      
      // Add assistant message with update buttons if Mermaid code is present
      setMessages(prev => [...prev, { 
        id: Date.now() + 1, 
        role: 'assistant', 
        content: data.message,
        showUpdateButtons: !!mermaidCode,
        mermaidCode: mermaidCode
      }]);
    } catch (error) {
      console.error('Error:', error);
      setMessages(prev => [...prev, { 
        id: Date.now() + 1, 
        role: 'assistant', 
        content: 'エラーが発生しました。もう一度お試しください。' 
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="chat-container">
      <div className="messages-container">
        {messages.map((message) => (
          <div key={message.id} className={`message ${message.role}`}>
            <div className="message-content">
              {message.content}
              {message.showUpdateButtons && (
                <div className="update-buttons">
                  <button 
                    type="button"
                    onClick={() => handleUpdateFlowchart(message.mermaidCode)}
                    className="update-button"
                  >
                    フローチャートを更新する
                  </button>
                  <button 
                    type="button"
                    onClick={() => {
                      setMessages(prev => 
                        prev.map(msg => 
                          msg.id === message.id
                            ? { ...msg, showUpdateButtons: false }
                            : msg
                        )
                      );
                    }}
                    className="cancel-button"
                  >
                    更新しない
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>
      <div className="input-container">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
          placeholder="メッセージを入力..."
          disabled={isLoading}
        />
        <button 
          type="button"
          onClick={handleSendMessage}
          disabled={isLoading || !input.trim()}
          className="send-button"
        >
          {isLoading ? '送信中...' : '送信'}
        </button>
      </div>
    </div>
  );
}

export default Chat; 