import { z } from 'zod';
import { allowedTables } from './schemaContext';

export const Spec = z.object({
  sql: z.string(),

  assumptions: z.object({
    ack:   z.string().optional().nullable().transform(v => v ?? undefined),
    reas:  z.array(z.string()).optional().nullable().transform(v => v ?? undefined),
    fu:    z.string().optional().nullable().transform(v => v ?? undefined),

    chart: z.object({
      mark:   z.string().optional(), // let auto-mark decide if absent
      x:      z.string().optional().nullable().transform(v => v ?? undefined),
      y:      z.array(z.string()).optional().nullable().transform(v => v ?? undefined),
      color:  z.string().optional().nullable().transform(v => v ?? undefined),
      reason: z.string().optional().nullable().transform(v => v ?? undefined),
    })
    .optional()  // <-- key may be missing entirely
    .nullable()
    .transform(v => v ?? undefined),
  })
  .optional()    // <-- assumptions may be missing entirely
  .nullable()
  .transform(v => v ?? undefined),
});



// Remove SQL comments + one trailing semicolon
export function normalizeSql(sql: string) {
  let s = sql.trim();
  // strip line comments
  s = s.replace(/--.*$/gm, '');
  // strip block comments
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');
  s = s.trim();
  // strip a single trailing semicolon (or a few, just in case)
  s = s.replace(/;+\s*$/,'').trim();
  return s;
}

const forbidden = /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|DO)\b/i;

// any semicolon **inside** the query (not the one we already stripped) => reject
const semicolon = /;(?=(?:[^'"]|'[^']*'|"[^"]*")*$)/;

export function ensureSelectOnly(sql: string) {
  if (forbidden.test(sql)) throw new Error('Only SELECT is allowed.');
  if (!/^\s*(WITH|SELECT)\b/i.test(sql)) throw new Error('Query must start with SELECT/CTE.');
  if (semicolon.test(sql)) throw new Error('Multiple statements are not allowed.');
}



// Extract fully-qualified tables used in FROM/JOIN (and their aliases)
function extractTables(sql: string): Array<{ table: string; alias?: string }> {
  const out: Array<{ table: string; alias?: string }> = [];
  // collapse whitespace to make regex simpler
  const s = sql.replace(/\s+/g, ' ');
  const re = /\b(from|join)\s+([a-z_][\w]*)\.([a-z_][\w]*)(?:\s+(?:as\s+)?([a-z_][\w]*))?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const schema = m[2].toLowerCase();
    const table = m[3].toLowerCase();
    const alias = (m[4] || '').toLowerCase() || undefined;
    out.push({ table: `${schema}.${table}`, alias });
  }
  return out;
}

// Validate ONLY the tables discovered in FROM/JOIN
export function ensureAllowedTables(sql: string) {
  const used = extractTables(sql);
  if (used.length === 0) return; // nothing to validate (unlikely, but fine)

  // allowedTables should be lowercased in schemaContext.ts; if not, normalize here:
  // const allowed = allowedTables.map(t => t.toLowerCase());

  const unknown = used
    .map(u => u.table)
    .filter(t => !allowedTables.includes(t));

  if (unknown.length) {
    throw new Error(`Unknown/forbidden tables: ${Array.from(new Set(unknown)).join(', ')}`);
  }
}

export function ensureLimit(sql: string, _maxLimit: number) {
  // (We always inject param slots at runtime; we just require a LIMIT clause to exist)
  if (!/\blimit\b/i.test(sql)) {
    return `${sql.trim()}\nLIMIT $1 OFFSET $2`;
  }
  return sql;
}

export function applyTimeGuard(sql: string, timeCol: string) {
  if (!/\bwhere\b/i.test(sql) && /\b(date_trunc|timestamp|time)\b/i.test(sql)) {
    return `${sql.trim()}\nWHERE ${timeCol} >= NOW() - INTERVAL '30 days'`;
  }
  return sql;
}
