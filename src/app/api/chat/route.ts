// app/api/chat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { planSqlFromNLWithContext } from '../../../lib/llm';

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

type ChatRequest = {
  sessionId: string;
  message: string;
  history: ChatMessage[];
};

// In-memory session storage (use Redis/DB in production)
const sessions = new Map<string, ChatMessage[]>();

export async function POST(request: NextRequest) {
  try {
    const body: ChatRequest = await request.json();
    const { sessionId, message, history } = body;

    // Get or create session history
    let sessionHistory = sessions.get(sessionId) || [];
    
    // Merge with provided history (client might have more recent messages)
    if (history.length > sessionHistory.length) {
      sessionHistory = history;
    }

    // Add current user message to history
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: message,
      timestamp: new Date(),
    };
    sessionHistory.push(userMessage);

    // Generate SQL with conversation context
    const result = await planSqlFromNLWithContext(message, sessionHistory);

    console.log("+++++++++ RESULT +++++++++\n", result);

    // Create assistant response with proper structure
    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: result.assumptions?.ack || 'Generated SQL query',
      sql: result.sql,
      assumptions: result.assumptions,
      timestamp: new Date(),
    };

    // Add to session history
    sessionHistory.push(assistantMessage);
    
    // Store updated session (with size limit)
    if (sessionHistory.length > 20) {
      sessionHistory = sessionHistory.slice(-20); // Keep last 20 messages
    }
    sessions.set(sessionId, sessionHistory);

    return NextResponse.json({
      content: assistantMessage.content,
      sql: result.sql,
      assumptions: result.assumptions,
      sessionId,
    });

  } catch (error) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// Optional: Add session cleanup
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('sessionId');
  
  if (sessionId) {
    sessions.delete(sessionId);
    return NextResponse.json({ success: true });
  }
  
  return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
}