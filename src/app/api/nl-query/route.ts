import { NextRequest, NextResponse } from 'next/server';
import { planSqlFromNL } from '@/lib/llm';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { text } = await req.json();
    // Optional small hints; full schema is injected by llm.ts
    const hints = [
      'Preferred join: public.tx AS t JOIN public.block AS b ON t.block_hash = b.block_hash',
      'Use b."time" for block-day rollups; t."timestamp" for tx timelines',
    ];
    const plan = await planSqlFromNL(text, hints);
    return NextResponse.json(plan); // { sql, assumptions }
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'planning failed' }, { status: 400 });
  }
}
