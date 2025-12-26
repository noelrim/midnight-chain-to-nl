// components/ChatInterface.tsx - Fixed to handle new JSON format correctly
'use client';

import { useState, useRef, useEffect } from 'react';
import {
  MainContainer,
  ChatContainer,
  MessageList,
  Message,
  MessageInput,
  TypingIndicator,
  MessageModel,
  type MessageListRef
} from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import SqlViewer from './SqlViewer';

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  assumptions?: {
    ack?: string;
    reas?: string[];
    fu?: string;
    chart?: {
      mark: string;
      x?: string;
      y?: string[];
      color?: string;
      reason?: string;
    };
  };
  timestamp: Date;
};

type ChatInterfaceProps = {
  onSqlGenerated: (sql: string, assumptions: any) => void; // Changed to accept any for assumptions
  onExecuteQuery: (sql: string, assumptions: any) => Promise<void>; // Changed to accept any for assumptions
};

function renderMarkdownLinks(text: string) {
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  const parts: (string | JSX.Element)[] = [];
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    const [full, label, url] = match;
    parts.push(text.slice(lastIndex, match.index)); // plain text before the match
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: "#60A5FA", textDecoration: "underline" }}
      >
        {label}
      </a>
    );
    lastIndex = match.index + full.length;
  }

  parts.push(text.slice(lastIndex)); // tail
  return parts;
}

export default function ChatInterface({ onSqlGenerated, onExecuteQuery }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [executingQueryId, setExecutingQueryId] = useState<string | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const listRef = useRef<MessageListRef | null>(null);

  // Force scroll to bottom whenever messages change
  useEffect(() => {
    listRef.current?.scrollToBottom("smooth");
    const id = requestAnimationFrame(() => {
      listRef.current?.scrollToBottom("auto");
    });
    return () => cancelAnimationFrame(id);
  }, [messages]);

  const handleSend = async (message: string) => {
    if (!message.trim() || isLoading) return;

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message.trim(),
      timestamp: new Date(),
    };

    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setIsLoading(true);

    try {

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message: message.trim(),
          history: updatedMessages.map(m => ({
            id: m.id,
            role: m.role,
            content: m.content,
            sql: m.sql,
            assumptions: m.assumptions,
            timestamp: m.timestamp,
          })),
        }),
      });

      if (!response.ok) {
        throw new Error(`Request failed: ${response.statusText}`);
      }

      const data = await response.json();
      const assistantMessage: ChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.content || 'Generated SQL query',
        sql: data.sql,
        assumptions: data.assumptions,
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, assistantMessage]);
      
      if (data.sql) {
        // Pass the full assumptions object to parent
        onSqlGenerated(data.sql, data.assumptions || {});
      }

    } catch (error) {
      const errorMessage: ChatMessage = {
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

  const handleExecuteQuery = async (messageId: string, sql: string, assumptions: any) => {
    setExecutingQueryId(messageId);
    try {
      await onExecuteQuery(sql, assumptions);
    } finally {
      setExecutingQueryId(null);
    }
  };


  // Convert messages to chatscope format
  const chatMessages: MessageModel[] = messages.map((msg) => ({
    message: msg.content,
    sentTime: msg.timestamp.toLocaleTimeString(),
    sender: msg.role === 'user' ? 'user' : 'assistant',
    direction: msg.role === 'user' ? 'outgoing' : 'incoming',
    position: 'single',
  }));

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Welcome message when empty */}
      {messages.length === 0 && (
        <div style={{ 
          padding: '32px',
          paddingTop: '62px',
          textAlign: 'center',
        }}>
          <h3 style={{ margin: '0 0 8px 0', color: '#333' }}>
            Welcome to Midnight NL→SQL Chat!
          </h3>
          <p style={{ margin: '0', color: '#666', fontSize: '14px' }}>
            Ask me anything about your blockchain data. I'll help you craft the perfect SQL queries.
          </p>
        </div>
      )}

      <MainContainer style={{ flex: 1, minHeight: 0 }}>
        <ChatContainer>
          <MessageList
            ref={listRef}
            autoScrollToBottom={false}
            scrollBehavior="smooth" 
            typingIndicator={isLoading ? <TypingIndicator content="Thinking..." /> : null}
          >
            {messages.map((msg, index) => (
              <Message
                key={msg.id}
                model={chatMessages[index]}
                style={{
                  marginBottom: '12px',
                }}
              >
                {/* Custom content for assistant messages with SQL */}
                {msg.role === 'assistant' && (msg.sql || msg.assumptions) && (
                  <Message.CustomContent>
                    <div style={{ 
                      marginTop: '12px',
                      padding: '0',
                      maxWidth: '100%'
                    }}>
                      {/* SQL Display */}
                    {/*  
                    {msg.sql && (
                        <div style={{ marginBottom: '12px' }}>
                          <div style={{
                            fontSize: '16px',
                            fontWeight: 'bold',
                            color: '#E8ECF8',
                            marginBottom: '6px',
                            textTransform: 'uppercase',
                            letterSpacing: '0.5px'
                          }}>
                            Generated SQL
                          </div>
                          <SqlViewer 
                            code={msg.sql} 
                            style={{ 
                              maxHeight: '200px',
                              fontSize: '12px',
                              borderRadius: '6px'
                            }} 
                          />
                        </div>
                      )}
                      */}

                      {/* Assumptions Display */}
                      {msg.assumptions && (
                        <div style={{ marginBottom: '12px' }}>                        
                          {/* Acknowledgment */}
                          {msg.assumptions.ack && (
                            <div style={{ 
                              marginBottom: '8px', 
                              lineHeight: '1.4',
                              padding: "5px 0px",
                              color: '#E8ECF8'
                            }}>
                           {renderMarkdownLinks(msg.assumptions.ack)}
                            </div>
                          )}
                          
                          {/* Reasoning steps */}
                          {msg.assumptions.reas && msg.assumptions.reas.length > 0 && (
                            <div style={{ marginBottom: '8px' }}>
                              <div style={{ 
                                fontSize: '14px',
                                fontWeight: 'bold',
                                color: '#E8ECF8',
                                marginBottom: '4px'
                              }}>
                              </div>
                              <ul style={{ 
                                margin: '0', 
                                paddingLeft: '16px', 
                                lineHeight: '1.4',
                                color: '#D1D5DB'
                              }}>
                                {msg.assumptions.reas.map((reason, i) => (
                                  <li key={i} style={{ marginBottom: '4px' }}>
                                    {renderMarkdownLinks(reason)}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}
                          
                          {/* Follow-up/Conclusion */}
                          {msg.assumptions.fu && (
                            <div style={{ 
                              lineHeight: '1.4',
                              fontStyle: 'italic',
                              padding: "5px 0",
                              color: '#A1A1AA',
                              borderLeft: '3px solid #374151',
                              paddingLeft: '12px'
                            }}>
                              {renderMarkdownLinks(msg.assumptions.fu)}
                            </div>
                          )}

                          {/* Chart Recommendation */}
                          {msg.assumptions.chart && (
                            <div style={{ 
                              marginTop: '12px',
                              padding: '8px',
                              backgroundColor: 'rgba(59, 130, 246, 0.1)',
                              borderRadius: '6px',
                              border: '1px solid rgba(59, 130, 246, 0.3)'
                            }}>
                              <div style={{
                                fontWeight: 'bold',
                                color: '#60A5FA',
                                marginBottom: '4px'
                              }}>
                              </div>
                              {msg.assumptions.chart.reason && (
                                <div style={{ 
                                  marginTop: '6px',
                                  fontSize: '12px',
                                  color: '#D1D5DB',
                                  fontStyle: 'italic'
                                }}>
                                  {msg.assumptions.chart.reason}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Execute Button */}
                      {msg.sql && (
                        <button
                          onClick={() => handleExecuteQuery(msg.id, msg.sql!, msg.assumptions || {})}
                          disabled={executingQueryId === msg.id}
                          className="button-primary"
                          style={{
                            backgroundColor: executingQueryId === msg.id ? '#6B7280' : '#3B82F6',
                            color: 'white',
                            border: 'none',
                            padding: '8px 16px',
                            borderRadius: '6px',
                            cursor: executingQueryId === msg.id ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '14px',
                            fontWeight: '500'
                          }}
                        >
                          {executingQueryId === msg.id ? (
                            <>
                              <div style={{
                                width: '16px',
                                height: '16px',
                                border: '2px solid transparent',
                                borderTop: '2px solid white',
                                borderRadius: '50%',
                                animation: 'spin 1s linear infinite'
                              }} />
                              Executing...
                            </>
                          ) : (
                            <>Execute Query ➡</>
                          )}
                        </button>
                      )}
                    </div>
                  </Message.CustomContent>
                )}
              </Message>
            ))}
          </MessageList>

          <MessageInput
            placeholder="Ask me about your data... (Shift+Enter for new line)"
            onSend={handleSend}
            disabled={isLoading}
            attachButton={false}
            sendButton={true}
            style={{
              fontSize: '14px'
            }}
          />
        </ChatContainer>
      </MainContainer>

      {/* Session info */}
      <div style={{
        padding: '8px 16px',
        fontSize: '11px',
        color: '#666',
        borderTop: 'none',
        backgroundColor: 'transparent',
        display: 'flex',
        justifyContent: 'space-between'
      }}>
        <span>Session: {sessionId.slice(0, 8)}...</span>
        <span>Context preserved across messages</span>
      </div>

      {/* Spinner animation */}
      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}