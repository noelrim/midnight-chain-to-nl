// lib/llm.ts - Enhanced version with context support
import OpenAI from 'openai';
import { Spec } from './validateSql';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  sql?: string;
  assumptions?: {
    ack?: string;
    reas?: string[];
    fu?: string;  // Changed from 'c' to 'fu'
    chart?: {
      mark: string;
      x?: string;
      y?: string[];
      color?: string;
      reason?: string;
    };
  };
};

const SEARCH_RUBRIC = `
You have access to a web_search tool.
Use web_search ONLY when one of these holds:
If a question is conceptual/time-sensitive (news/‘latest’/dated ranges), call web_search and cite 2–3 sources.
- You are not confident the answer is fully known from the provided file prompt + chat context.
Do NOT search for: pure math/coding/SQL that can be answered locally from the spec/context.
If you do search, cite sources in the final answer.
Return ONLY strict JSON matching the target schema.
`;

function safeJsonParse(s: string) {
  try {
    return JSON.parse(s);
  } catch {
    const cleaned = s
      .replace(/^```json\s*|\s*```$/g, '')
      .replace(/;+\s*$/, '')
      .replace(/: undefined/g, ': null')
      .trim();
    return JSON.parse(cleaned);
  }
}

// Original function for backward compatibility
export async function planSqlFromNL(userText: string, extraContext: string[] = []) {
  return planSqlFromNLWithContext(userText, []);
}

// Enhanced function with conversation context
export async function planSqlFromNLWithContext(
  userText: string, 
  conversationHistory: ChatMessage[] = []
) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const defaultPath = path.resolve(here, './prompts/context-llm.llm');
  const llmPath = process.env.CONTEXT_LLM_PATH ?? defaultPath;
  const context = fs.readFileSync(llmPath, 'utf8');

  // Build conversation messages
  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: context },
  ];

  // Add conversation history (last 10 messages to avoid token limits)
  const recentHistory = conversationHistory.slice(-10);
  for (const historyMessage of recentHistory) {
    if (historyMessage.role === 'user') {
      messages.push({
        role: 'user',
        content: historyMessage.content,
      });
    } 
    else if (historyMessage.role === 'assistant' && historyMessage.sql) {
      // Include the SQL in assistant responses for context
      const assistantContent = [
        `Previous query: "${historyMessage.content}"`,
        historyMessage.sql ? `Generated SQL: ${historyMessage.sql}` : 'Conceptual response',
        historyMessage.assumptions?.ack ? `Response: ${historyMessage.assumptions.ack}` : '',
      ].filter(Boolean).join('\n');

      
      messages.push({
        role: 'assistant',
        content: assistantContent,
      });
    }
  }

  // Add current user message
  messages.push({
    role: 'user',
    content: userText,
  });

  // Small retry for transient 429s
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.responses.create({
        model: process.env.OPENAI_MODEL ?? 'gpt-5-mini',
        tools: [{ type: 'web_search' }],
        tool_choice: 'auto',
        input: messages, //[
         // { role: "system", content: SEARCH_RUBRIC }, // <-- wrap the rubric
        //  ...(Array.isArray(messages) ? messages : [messages]),
        //],

        // keep your session tag at the TOP LEVEL (not inside input)
        ...(conversationHistory.length > 0 ? {
          user: `session_${Date.now().toString().slice(-8)}`
        } : {}),
      });
      console.log(JSON.stringify(completion));
      for (const item of completion.output ?? []) {
  if (item.type === "tool_result" && item.tool === "web_search") {
    console.log("Web search results:", item.content);
  }
}    
      const raw = completion.output_text ?? '{}';
      const parsed = safeJsonParse(raw);

      return Spec.parse(parsed);
      
    } catch (err: any) {
      const msg = String(err?.message || '');
      if (attempt === 0 && (err?.status === 429 || /quota|rate limit/i.test(msg))) {
        await new Promise(r => setTimeout(r, 800));
        continue;
      }
      throw err;
    }
  }

  return Spec.parse({ 
    sql: 'SELECT 1 LIMIT $1 OFFSET $2', 
    assumptions: ['fallback due to error'] 
  });
}

// Utility function to summarize long conversations for context
export function summarizeConversation(history: ChatMessage[]): string {
  if (history.length === 0) return '';
  
  const topics = history
    .filter(m => m.role === 'user')
    .map(m => m.content)
    .slice(-5); // Last 5 user queries
    
  return `Recent topics: ${topics.join('; ')}`;
}