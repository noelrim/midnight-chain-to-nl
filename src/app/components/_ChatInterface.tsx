// components/ChatInterface.tsx
'use client';

import { useState, useRef, useEffect } from 'react';
import SqlViewer from './SqlViewer';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  assumptions?: string[];
  timestamp: Date;
};

type ChatInterfaceProps = {
  onSqlGenerated: (sql: string, assumptions: string[]) => void;
  onExecuteQuery: (sql: string, assumptions: string[]) => Promise<void>; // Make it async
};


export default function ChatInterface({ onSqlGenerated, onExecuteQuery }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sessionId] = useState(() => {
    // This will only run on client side due to ssr: false
    return crypto.randomUUID();
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [executingQueryId, setExecutingQueryId] = useState<string | null>(null);

  // Update the execute handler:
  const handleExecuteQuery = async (messageId: string, sql: string, assumptions: string[]) => {
    console.log('Execute clicked for:', messageId, sql.substring(0, 50));
    setExecutingQueryId(messageId);
    try {
      await onExecuteQuery(sql, assumptions);
      console.log('Execute completed');
    } catch (error) {
      console.error('Execute failed:', error);
    } finally {
      setExecutingQueryId(null);
    }
  };
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: input.trim(),
      timestamp: new Date(),
    };

    // Create the updated history immediately
    const updatedMessages = [...messages, userMessage];
    
    setMessages(updatedMessages);
    setInput('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: input.trim(),
          // Use the updated history that includes the new user message
          history: updatedMessages.map(m => ({
            role: m.role,
            content: m.content,
            sql: m.sql,
            assumptions: m.assumptions,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
      }

      const data = await response.json();
      
      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.content || '',
        sql: data.sql,
        assumptions: data.assumptions || [],
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      // Notify parent component
      if (data.sql) {
        onSqlGenerated(data.sql, data.assumptions || []);
      }

    } catch (error) {
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Something went wrong'}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };

  const getLoadingMessage = () => {
    const messages = [
      'Thinking...',
    ];
    return messages[Math.floor(Math.random() * messages.length)];
  };

  return (
    <div className="chat-container" style={{ 
      display: 'flex', 
      flexDirection: 'column', 
      height: '100%',
      minHeight: 0,
      overflow: 'hidden',
      position: 'relative',
      top: "70px",
      }}>
      {/* Chat Messages */}
      <div className="chat-messages" style={{ 
        position: 'absolute',    // Position absolutely
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,              // Extend to full height
        overflowY: 'auto',      // Scrollable
        padding: "50px 10px 120px 10px",
        display: 'flex',
        flexDirection: 'column',
        gap: '16px'
      }}>
        {messages.length === 0 && (
          <div className="note" style={{ textAlign: 'center', padding: '32px' }}>
            <h3>Welcome to Midnight NL→SQL Chat!</h3>
            <p>Ask me anything about your blockchain data. I'll help you craft the perfect SQL queries.</p>
            <p className="subtitle">Try: "Show me validator performance this week" or "Count transactions by day"</p>
          </div>
        )}

        {messages.map((message) => (
          <div key={message.id} style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: message.role === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div 
              className={message.role === 'assistant' ? 'assistant-message' : ''}
              style={{
                maxWidth: message.role === 'user' ? '80%' : '100%', // Full width for assistant
                padding: message.role === 'assistant' ? '16px 0' : '12px 16px', // No padding for assistant bubble
                borderRadius: message.role === 'user' ? '12px' : '0', // No border radius for assistant
                backgroundColor: message.role === 'user' ? '#007acc' : 'transparent', // Transparent background
                color: message.role === 'user' ? 'white' : 'inherit', // Inherit text color
                border: message.role === 'user' ? 'none' : 'none', // No border for assistant
              }}
            >
              <div style={{ marginBottom: message.sql ? '8px' : '0' }}>
                {message.content}
              </div> 
              
              {/* SQL and assumptions styling remains the same */}
              {message.sql && (
                <div style={{ marginTop: '12px' }}>
                  <div style={{ marginBottom: '8px',fontWeight:'bold',fontSize: '18px' }}>Generated SQL</div>
                  <SqlViewer code={message.sql} style={{ maxHeight: '200px' }} />
                </div>
              )}

              {message.assumptions && message.assumptions.length > 0 && (
                <div style={{ marginTop: '12px' }}>
                  <div  style={{ marginBottom: '8px',fontSize: '18px', fontWeight:'bold' }}>Assumptions</div>
                  <ul style={{ margin: '0', paddingLeft: '16px', fontSize: '16px' }}>
                    {message.assumptions.map((assumption, i) => (
                      <li key={i} style={{ marginBottom: '4px' }}>{assumption}</li>
                    ))}
                  </ul>
                </div>
              )}
              {message.sql && (
                <div style={{ marginTop: '12px' }}>
                    <button 
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleExecuteQuery(message.id, message.sql!, message.assumptions || []);
                      }}
                      className="btn"
                      style={{ 
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        backgroundColor: 'transparent',
                      }}
                      disabled={executingQueryId === message.id}
                    >
                    {executingQueryId === message.id ? (
                      <>
                        <div className="dot-loader">
                          <div className="dot"></div>
                          <div className="dot"></div>
                          <div className="dot"></div>
                        </div>
                        Executing...
                      </>
                    ) : (
                      <>⚡ Execute this query</>
                    )}
                  </button>
                </div>
              )}
                          </div>
            
            {/* Timestamp styling */}
            <div style={{ 
              fontSize: '12px', 
              color: '#666', 
              marginTop: '4px',
              alignSelf: message.role === 'user' ? 'flex-end' : 'flex-start'
            }}>
              {message.timestamp.toLocaleTimeString()}
            </div>
          </div>
        ))}

        {isLoading && (
          <div style={{ display: 'flex', alignItems: 'flex-start' }}>
            <div style={{
              padding: '12px 16px',
              borderRadius: '12px',
              backgroundColor: 'transparent',
              display: 'flex',
              alignItems: 'center',
              gap: '8px'
            }}>
              <div className="spinner" style={{
                width: '16px',
                height: '16px',
                border: '2px solid #e0e0e0',
                borderTop: '2px solid #007acc',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite'
              }} />
              {getLoadingMessage()}
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-box" style={{ 
        padding: '40px 5px 5px 5px', width: "100%",
      }}>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '8px' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me about your data... (Shift+Enter for new line, Enter to send)"
            className="textarea"
            style={{
              flex: 1,
              padding:10,

              minHeight: '60px',
              maxHeight: '120px',
              resize: 'vertical',
              fontFamily: 'inherit',
              borderRadius:"10px",
              borderWidth: "3px",
              backgroundColor:'#0d0d0d',
              
            }}
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={!input.trim() || isLoading}
            className="btn"
            style={{ alignSelf: 'flex-end' }}
          >
            {isLoading ? '...' : 'Send'}
          </button>
        </form>
        
        <div style={{ 
          fontSize: '12px', 
          color: '#666', 
          marginTop: '8px',
          display: 'flex',
          justifyContent: 'space-between'
        }}>
          <span>Session: {sessionId.slice(0, 8)}...</span>
          <span>Context preserved across messages</span>
        </div>
      </div>

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        
        .spinner {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}