import { NextRequest, NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { normalizeSql, ensureSelectOnly, ensureAllowedTables, ensureLimit } from '@/lib/validateSql';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const client = await pool.connect();
  try {
    const { sql, limit = 1000, offset = 0 } = await req.json();

    if (!sql || typeof sql !== 'string') {
      return NextResponse.json({ error: 'Missing sql' }, { status: 400 });
    }
    let safe = normalizeSql(sql);          // ⟵ normalize first
    ensureSelectOnly(safe);
    ensureAllowedTables(safe);
    safe = ensureLimit(safe, Number(process.env.MAX_LIMIT ?? 1000));

    await client.query(`SET LOCAL statement_timeout = '10s'`);
    const { rows } = await client.query(safe, [Number(limit), Number(offset)]);

console.log(NextResponse.json({ rows, sql: safe }));

    return NextResponse.json({ rows, sql: safe });
  } catch (e: any) {
    return NextResponse.json({ error: e.message ?? 'query failed' }, { status: 400 });
  } finally {
    client.release();
  }
}
