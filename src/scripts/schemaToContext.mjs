// schema-snapshot.mjs (merged extractor)
// Build the *ultimate* LLM context from DB + YAML semantics.
// Usage:
//   PG_URL=postgres://user:pass@host:5432/db node schema-snapshot.mjs [schema] [jsonOut] [llmOut] [logOut] [promptOut]
// Defaults:
//   schema  = "public"
//   jsonOut = "context-llm.json"
//   llmOut  = "context-llm.llm"
//   logOut  = "delta.log"
// Env:
//   CONTEXT_YML (default: ./db-context.yml)

import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import crypto from 'crypto';
import yaml from 'js-yaml';

// ---- verbose logging ----
const VERBOSE = process.argv.includes('--verbose') || process.env.VERBOSE === '1';
const ts = () => new Date().toISOString();
const log = (lvl, ...args) => { if (lvl === 'debug' && !VERBOSE) return; console.log(`[${ts()}] [${lvl.toUpperCase()}]`, ...args); };
const info = (...a) => log('info', ...a);
const warn = (...a) => log('warn', ...a);
const error = (...a) => log('error', ...a);
const debug = (...a) => log('debug', ...a);

// ---- CLI & ENV ----
const SCHEMA = (process.argv[2] || 'public').toLowerCase();
const JSON_OUT = process.argv[3] || 'context-llm.json';
const LOG_OUT  = process.argv[4] || 'delta.log';
const PROMPT_OUT = process.argv[5] || 'enhanced-prompt.txt';
const YML_PATH = process.env.CONTEXT_YML || './db-context.yml';

// ---- PG POOL ----
const CONN_STR = process.env.PG_URL || process.env.DATABASE_URL || 'postgresql://localhost:5432/indexer';
const CONN_TIMEOUT = parseInt(process.env.PG_CONNECT_TIMEOUT_MS || '8000', 10);
const STMT_TIMEOUT = parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '15000', 10);
function redactUrl(u){
  try{ const url = new URL(u); if (url.password) url.password = '***'; return url.toString(); }catch{ return u.replace(/:(?:[^@]+)@/,'://***@'); }
}
const pool = new Pool({
  connectionString: CONN_STR,
  application_name: 'schema-snapshot-merged',
  max: 3,
  connectionTimeoutMillis: CONN_TIMEOUT,
});

// ---- Utils ----

// ---- Optional tokenizer (for token breakdown) ----
let __enc = null; // lazy-loaded if available
async function ensureTokenizer() {
  if (__enc) return __enc;
  try {
    const { encoding_for_model, get_encoding } = await import('@dqbd/tiktoken');
    __enc = (encoding_for_model ? encoding_for_model('gpt-4o') : null) || (get_encoding ? get_encoding('o200k_base') : null);
  } catch { /* optional */ }
  return __enc;
}
function countTokensApprox(s){
  if (!s) return 0;
  if (!__enc) return Math.ceil(String(s).split(/\s+/).length * 1.3);
  try { return __enc.encode(String(s)).length; } catch { return Math.ceil(String(s).split(/\s+/).length * 1.3); }
}
// ---- Helpers for headings from YAML keys ----
const prettyHeadingFromKey = (k) => String(k||'')
  .replace(/_/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .replace(/\b\w/g, (m) => m.toUpperCase());

const groupJoins = (joins) => {
  const isHard = joins[0].includes('→');
  
  if (isHard) {
    // Hard joins: Group by target (multiple sources can point to same target)
    const groups = new Map();
    
    joins.forEach(join => {
      const parts = join.match(/(\w+)\.(\w+)→(\w+)\.(\w+)/);
      if (parts && parts[2] === parts[4]) { // Same column name
        const [, leftTable, column, rightTable] = parts;
        const key = `${rightTable}_${column}`; // Group by target + column
        
        if (!groups.has(key)) {
          groups.set(key, { column, target: rightTable, sources: new Set() });
        }
        groups.get(key).sources.add(leftTable);
      }
    });
    
    return Array.from(groups.values()).map(group => {
      const sources = Array.from(group.sources).sort().join('/');
      return `${sources}→${group.target}(${group.column})`;
    });
    
  } else {
    // Soft joins: Connected components (bidirectional)
    const columnGraphs = new Map();
    
    joins.forEach(join => {
      const parts = join.match(/(\w+)\.(\w+)≈(\w+)\.(\w+)/);
      if (parts && parts[2] === parts[4]) {
        const [, leftTable, column, rightTable] = parts;
        
        if (!columnGraphs.has(column)) {
          columnGraphs.set(column, new Map());
        }
        
        const graph = columnGraphs.get(column);
        
        // Add bidirectional edges
        if (!graph.has(leftTable)) graph.set(leftTable, new Set());
        if (!graph.has(rightTable)) graph.set(rightTable, new Set());
        
        graph.get(leftTable).add(rightTable);
        graph.get(rightTable).add(leftTable);
      }
    });
    
    // Find connected components (same DFS logic as before)
    const results = [];
    
    for (const [column, graph] of columnGraphs) {
      const visited = new Set();
      
      const dfs = (node, component) => {
        visited.add(node);
        component.push(node);
        
        for (const neighbor of graph.get(node) || []) {
          if (!visited.has(neighbor)) {
            dfs(neighbor, component);
          }
        }
      };
      
      for (const node of graph.keys()) {
        if (!visited.has(node)) {
          const component = [];
          dfs(node, component);
          if (component.length > 1) {
            results.push(`${component.sort().join('≈')}(${column})`);
          }
        }
      }
    }
    
    return results;
  }
};



// ---- Prompt Assembler ----
function assemblePrompt({ yamlCtx, merged, minified, sectionsCfg }){
  const lines = [];
  const sectionTokens = {};
  const pushSection = (name, buildFn) => {
    const enabled = !!sectionsCfg?.[name];
    if (!enabled) return;
    const startIdx = lines.length;
    buildFn(lines);
    const text = lines.slice(startIdx).join('\n');
    sectionTokens[name] = countTokensApprox(text);
  };

  // 1) Core Instructions
  pushSection('core_instructions', (out) => {
    out.push('## Core Instructions');
    const role = yamlCtx?.rules?.role || 'You are a PostgreSQL query generator. You MUST follow these rules exactly.';
    out.push(`Role: ${role}`);
    out.push('');
    out.push('**CRITICAL: Output format is JSON only:**');
    const exampleJson = yamlCtx?.rules?.output ? yamlCtx.rules.output : '{sql:SELECT ...",assumptions:["..."]}';
    out.push(exampleJson);
    out.push('');
  });

  // 2) Absolute Rules (Non-Negotiable)
  pushSection('absolute_rules', (out) => {
    const abs = yamlCtx?.rules?.absolute || {};
    out.push('## Absolute Rules (Non-Negotiable)');
    for (const [subKey, items] of Object.entries(abs)){
      const title = prettyHeadingFromKey(subKey);
      out.push('');
      out.push(`### ${title}`);
      for (const rule of (Array.isArray(items) ? items : [])){
        out.push(`- ${rule}`);
      }
    }
    out.push('');
  });


  // 6) Available Tables & Columns (from minified)
  pushSection('common_patterns', (out) => {
    out.push('## Available Tables & Columns');
    // 3) Table aliases
    pushSection('aliases', (out) => {
      const aliasMap = merged.tables
        .map(t => `${t.table}:${t.primary_alias}`)
        .join(', ');
      out.push(`Format: table:alias(field:type, ...)`);
      out.push('');
    });

      if ((minified.perTable||[]).length) { if ((minified.perTable||[]).length) { for (const t of minified.perTable) out.push(`- ${t}`); } else { out.push('- (none)'); } } else { out.push('- (none)'); }
      out.push('');
      out.push('## Approved Joins');
      // Simple manual grouping that actually works
      const hardJoins = (minified.joins?.hard || []);
      const softJoins = (minified.joins?.soft || []);
      
      if (hardJoins.length) {
        out.push(`Hard: ${groupJoins(hardJoins).join(', ')}`);
      }
      if (softJoins.length) {
        out.push(`Soft: ${groupJoins(softJoins).join(', ')}`);
      }
  
    //out.push('hard:');
    //if ((minified.joins?.hard||[]).length) { if ((minified.joins?.hard||[]).length) { for (const j of (minified.joins?.hard || [])) out.push(`  - ${j}`); } else { out.push('  - (none)'); } } else { out.push('  - (none)'); }
    //out.push('soft:');
    //if ((minified.joins?.soft||[]).length) { if ((minified.joins?.soft||[]).length) { for (const j of (minified.joins?.soft || [])) out.push(`  - ${j}`); } else { out.push('  - (none)'); } } else { out.push('  - (none)'); }
    out.push('');
  });

  // 7) Query Analysis Patterns (from YAML)
  pushSection('query_analysis', (out) => {
    const ap = yamlCtx?._raw?.analysis_patterns || yamlCtx?.analysis_patterns || {};
    if (!Object.keys(ap).length) return;
    out.push('## Query Analysis Patterns');
    if (ap.concepts) out.push('- Concepts: ' + Object.keys(ap.concepts).join(', '));
    if (ap.soft_join_keys) out.push('- Soft join keys: ' + (ap.soft_join_keys||[]).join(', '));
    out.push('');
  });

  // 8) Time Handling
  pushSection('time_handling', (out) => {
    const th = yamlCtx?.rules?.time || {};
    const guidance = yamlCtx?.rules?.time?.guidance || yamlCtx?.rules?.guidance || [];
    out.push('## Time Handling');
    if (th.always_utc || th.timezone === 'UTC') out.push('- Always use UTC for all date/time logic.');
    if (Array.isArray(guidance)) for (const g of guidance) out.push(`- ${g}`);
    out.push('');
  });

  // 9) Validation Checklist
  pushSection('validation_checklist', (out) => {
    const vc = yamlCtx?.rules?.validation?.pre_output_checks || [];
    const vcc = yamlCtx?.rules?.validation?.critical || [];
    if (!vc.length) return;
    out.push('## Validation Checklist (Before Returning)');
    for (const v of vc) out.push(`- ${v}`);
    out.push('');

    out.push(`Critical: ${vcc}`);

  });

  return { text: lines.join('\n'), sectionTokens };
}

const nowIso = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const toFQName = (schema, table) => `${schema}.${table}`.toLowerCase();
const shortType = (t) => {
  const s = String(t || '').toLowerCase();
  if (s.startsWith('timestamp')) return 'ts';
  if (s === 'timestamp with time zone') return 'ts';
  if (s === 'character varying' || s === 'varchar' || s === 'text') return 'text';
  if (s === 'integer' || s === 'int4') return 'int';
  if (s === 'smallint' || s === 'int2') return 'smallint';
  if (s === 'bigint' || s === 'int8') return 'bigint';
  if (s.startsWith('numeric') || s === 'numeric' || s === 'decimal') return 'num';
  if (s === 'double precision' || s === 'float8') return 'double';
  if (s === 'real' || s === 'float4') return 'float';
  if (s === 'boolean' || s === 'bool') return 'bool';
  if (s === 'uuid') return 'uuid';
  if (s.startsWith('json')) return 'json';
  if (s === 'bytea') return 'bytea';
  return s.replace(/\s+/g, '_');
};

const SKIP_RE = /\b(skip|ignore)\b/i;

function appendLog(lines, path) {
  try { fs.appendFileSync(path, lines.join('\n') + '\n'); } catch {}
}

function loadYamlContext(path) {
  const src = fs.readFileSync(path, 'utf8');
  const y = yaml.load(src) || {};
  // Collect only table entries (exclude keys starting with "_")
  const tables = new Map();
  for (const [k, v] of Object.entries(y.tables || {})) {
    if (k.startsWith('_')) continue;
    const fq = String(k).toLowerCase();
    if (!fq.includes('.')) continue;
    const t = v || {};
    // Skip/ignore markers
    const desc = String(t.description || '');
    const notes = String(t.notes || '');
    if (SKIP_RE.test(desc) || SKIP_RE.test(notes)) continue;

    tables.set(fq, {
      fqname: fq,
      schema: fq.split('.')[0],
      table: fq.split('.')[1],
      primary_alias: t.primary_alias || null,
      aliases: Array.isArray(t.aliases) ? t.aliases.filter(Boolean) : [],
      semantic_tags: Array.isArray(t.semantic_tags) ? t.semantic_tags.filter(Boolean) : [],
      query_hints: Array.isArray(t.query_hints) ? t.query_hints.filter(Boolean) : [],
      soft_join_keys: Array.isArray(t.soft_join_keys) ? t.soft_join_keys.filter(Boolean) : [],
      raw: t,
    });
  }
  // Optional top-level rules
  const rules = y.rules || null;
  // Capture alias groups (if any) for optional semantics output
  const alias_groups = y._alias_groups || null;

  return { tables, rules, alias_groups, _raw: y };
}

async function snapshotDb(schema) {
  const client = await pool.connect();
  try {
    info('Connecting to Postgres…');
    await client.query(`SET statement_timeout = ${STMT_TIMEOUT}`);
    debug('SET statement_timeout ok');

    // 1) Columns (+ default/nullability)
    info('Querying columns…');
    const colsQ = `
      SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
             c.is_nullable, c.column_default, c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema = $1
      ORDER BY c.table_schema, c.table_name, c.ordinal_position;`;
    const cols = await client.query(colsQ, [schema]);

    console.log("Processed in: ",  cols.rowCount, "<OUt");
    info('Columns rows:', cols.rowCount);

    // 2) Primary keys
    info('Querying primary keys…');
    const pksQ = `
      SELECT n.nspname AS table_schema, rel.relname AS table_name,
             a.attname AS column_name, a.attnum AS attnum
      FROM pg_index i
      JOIN pg_class rel      ON rel.oid = i.indrelid
      JOIN pg_namespace n    ON n.oid   = rel.relnamespace
      JOIN unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
      JOIN pg_attribute a    ON a.attrelid = rel.oid AND a.attnum = k.attnum
      WHERE i.indisprimary = TRUE AND n.nspname = $1
      ORDER BY table_schema, table_name, k.ord;`;
    const pks = await client.query(pksQ, [schema]);
    info('PK rows:', pks.rowCount);

    // 3) Foreign keys (hard joins)
    info('Querying foreign keys…');
    const fksQ = `
      SELECT src_ns.nspname AS src_schema, src.relname AS src_table,
             a_src.attname  AS src_col,
             tgt_ns.nspname AS tgt_schema, tgt.relname AS tgt_table,
             a_tgt.attname  AS tgt_col,
             con.conname    AS constraint_name
      FROM pg_constraint con
      JOIN pg_class src         ON src.oid = con.conrelid
      JOIN pg_namespace src_ns  ON src_ns.oid = src.relnamespace
      JOIN pg_class tgt         ON tgt.oid = con.confrelid
      JOIN pg_namespace tgt_ns  ON tgt_ns.oid = tgt.relnamespace
      JOIN unnest(con.conkey) WITH ORDINALITY AS k_src(attnum, ord) ON TRUE
      JOIN pg_attribute a_src ON a_src.attrelid = src.oid AND a_src.attnum = k_src.attnum
      JOIN unnest(con.confkey) WITH ORDINALITY AS k_tgt(attnum, ord) ON k_tgt.ord = k_src.ord
      JOIN pg_attribute a_tgt ON a_tgt.attrelid = tgt.oid AND a_tgt.attnum = k_tgt.attnum
      WHERE con.contype = 'f' AND src_ns.nspname = $1 AND tgt_ns.nspname = $1
      ORDER BY src.relname, k_src.ord;`;
    const fks = await client.query(fksQ, [schema]);
    info('FK rows:', fks.rowCount);

    // Assemble tables map
    const pkSet = new Set(pks.rows.map(r => toFQName(r.table_schema, r.table_name) + '.' + r.column_name.toLowerCase()));
    const tables = new Map();

    for (const r of cols.rows) {

      const fq = toFQName(r.table_schema, r.table_name);

      if (!tables.has(fq)) tables.set(fq, { schema: r.table_schema.toLowerCase(), table: r.table_name.toLowerCase(), columns: [] });
      tables.get(fq).columns.push({
        name: r.column_name.toLowerCase(),
        type: r.data_type,
        primary: pkSet.has(fq + '.' + r.column_name.toLowerCase()),
        ...(r.is_nullable === 'NO' ? { nullable: false } : {}),
        ...(r.column_default != null ? { default: r.column_default } : {}),
      });
    }


    info('DB tables found:', tables.size);
  

    // Hard joins (FK)
    const hard = [];
    for (const r of fks.rows) {
      hard.push({
        from: toFQName(r.src_schema, r.src_table),
        from_col: r.src_col.toLowerCase(),
        to: toFQName(r.tgt_schema, r.tgt_table),
        to_col: r.tgt_col.toLowerCase(),
        constraint: r.constraint_name,
      });
    }


    return { tables, hard };
  } finally {
    try { debug('Releasing client…'); client.release(); } catch {}
    debug('Ending pool…');
    await pool.end();
  }
}


// Build a case-insensitive ^(?:a|b|c)$ regex from YAML joins_allow (or rules.joins_allow)
function denyRegexFromYaml(yamlCtx) {
  const raw = (yamlCtx && (yamlCtx.joins_deny || yamlCtx.rules?.joins_deny)) || '';
  const s = String(raw).trim();
  if (!s) return null;
  try { return new RegExp(`^(?:${s})$`, 'i'); }
  catch { return null; }
}

function mergeYamlIntoDb(yamlCtx, dbSnap, logPath) {
  const logs = [];
  const yamlTables = yamlCtx.tables; // Map fq -> semantics
  const globalAliasSet = buildGlobalAliasSet(yamlCtx.alias_groups);

  // Filter DB tables to YAML-authoritative set
  const mergedTables = [];
  const allowedSet = new Set(yamlTables.keys());
  const denyRe = denyRegexFromYaml(yamlCtx);


  for (const [fq, t] of dbSnap.tables.entries()) {
    if (!allowedSet.has(fq)) continue; // keep only YAML tables
    const y = yamlTables.get(fq);

    // Columns: keep only those that exist in DB; log YAML-only columns later
    const dbColsByName = new Map(t.columns.map(c => [c.name, c]));



    // Prepend strong hints from YAML query_hints if they mention column names
    const hintedCols = new Set();
    for (const hint of (y.query_hints || [])) {
      const words = String(hint).match(/[A-Za-z0-9_]+/g) || [];
      for (const w of words) {
        const key = w.toLowerCase();
        if (dbColsByName.has(key)) hintedCols.add(key);
      }
    }
    if (hintedCols.size) {
      const list = Array.from(hintedCols).filter(c => /time|timestamp|date|start_ts|end_ts/i.test(c));

    }

    mergedTables.push({
      fqname: fq,
      schema: t.schema,
      table: t.table,
      primary_alias: y.primary_alias,
      columns: t.columns, // already lean (nullable/default only when useful)
      aliases: dedupeStrings((y.aliases || []).filter(a => {
      const s = String(a || '').trim().toLowerCase();
      return s && !globalAliasSet.has(s);
    })),
      semantic_tags: y.semantic_tags,
      query_hints: dedupeStrings(y.query_hints),
      soft_join_keys: dedupeStrings(y.soft_join_keys),
    });
  }

  // Log YAML tables missing in DB
  for (const fq of yamlTables.keys()) {
    if (!dbSnap.tables.has(fq)) logs.push(`[DROP] YAML table not in DB: ${fq}`);
  }

  // Build hard joins, restricted to YAML tables
  const hard = [];
  const hardKey = new Set();
  for (const j of dbSnap.hard) {
    if (!allowedSet.has(j.from) || !allowedSet.has(j.to)) continue;
    const key = `${j.from}|${j.from_col}|${j.to}|${j.to_col}`;
    if (hardKey.has(key)) continue;
    hardKey.add(key);
    hard.push(j);
  }

  // Build soft joins by same-name same-type across YAML tables
  const soft = [];
  const softSeen = new Set();
  const byFq = new Map(mergedTables.map(t => [t.fqname, t]));
  const fqList = mergedTables.map(t => t.fqname);
  for (let i = 0; i < fqList.length; i++) {
    for (let j = i + 1; j < fqList.length; j++) {
      const a = byFq.get(fqList[i]);
      const b = byFq.get(fqList[j]);
      // Index columns by name and type
      const aCols = new Map(a.columns.map(c => [c.name + '|' + String(c.type).toLowerCase(), c]));
      for (const bc of b.columns) {
        const key = bc.name + '|' + String(bc.type).toLowerCase();
        if (!aCols.has(key)) continue;
        // Skip if a hard join already exists on same col pair (any direction)
        const alreadyHard = hard.some(h => (
          (h.from === a.fqname && h.to === b.fqname && h.from_col === bc.name && h.to_col === bc.name) ||
          (h.from === b.fqname && h.to === a.fqname && h.from_col === bc.name && h.to_col === bc.name)
        ));
        if (alreadyHard) continue;
        const id = [a.fqname, bc.name, b.fqname, bc.name].join('|');
        if (softSeen.has(id)) continue;
        softSeen.add(id);

        // If allow list is present, keep only if the column name is allowed (names are equal on both sides here)
        if (denyRe && denyRe.test(bc.name)) {
          logs.push(`[DROP-SOFT] ${a.fqname}.${bc.name} ≈ ${b.fqname}.${bc.name} (not in joins_allow)`);
          continue;
        }

        soft.push({ left: a.fqname, left_col: bc.name, right: b.fqname, right_col: bc.name, reason: 'same-name same-type' });
        logs.push(`[SOFT] ${a.fqname}.${bc.name} ≈ ${b.fqname}.${bc.name} (allowed by joins_allow)`);

      }
    }
  }

  return { tables: mergedTables, joins: { hard, soft }, logs };
}

function dedupeStrings(arr) {
  return Array.from(new Set((arr || []).map(s => String(s).trim()).filter(Boolean)));
}

// Build a global synonym set from _alias_groups to de-dup per-table aliases
function buildGlobalAliasSet(alias_groups) {
  const set = new Set();
  if (!alias_groups || typeof alias_groups !== 'object') return set;
  for (const arr of Object.values(alias_groups)) {
    if (!Array.isArray(arr)) continue;
    for (const term of arr) {
      const t = String(term || '').trim().toLowerCase();
      if (t) set.add(t);
    }
  }
  return set;
}


function buildMinified(merged) {

  const perTable = [];
  for (const t of merged.tables) {
    const cols = t.columns.map(c => {
      let s = `${c.name}:${shortType(c.type)}`;
      if (c.primary) s += ' PK';
      return s;
    });

    perTable.push(`${t.table}:${t.primary_alias}(${cols.join(', ')})`);
  }
  perTable.sort();

  // Build alias map for joins
  const aliasOf = Object.fromEntries(merged.tables.map(t => [t.fqname, t.primary_alias]));

  const hard = merged.joins.hard.map(j =>
    `${aliasOf[j.from]}.${j.from_col}→${aliasOf[j.to]}.${j.to_col}`  // Remove constraint names
  );
  const soft = merged.joins.soft.map(j =>
    `${aliasOf[j.left]}.${j.left_col}≈${aliasOf[j.right]}.${j.right_col}`
  );

  return { perTable, joins: { hard, soft } };
}




(async function run() {
  const delta = [];
  const start = Date.now();
  info('Starting merged schema snapshot');
  info('Schema:', SCHEMA);
  info('YAML path:', YML_PATH);
  info('Outputs:', JSON_OUT, PROMPT_OUT, LOG_OUT);
  info('PG:', redactUrl(CONN_STR), `connTimeout=${CONN_TIMEOUT}ms`, `stmtTimeout=${STMT_TIMEOUT}ms`);
  const INCLUDE_SEM = process.argv.includes('--semantics') || process.env.SEMANTICS === '1';
  info('Semantics section:', INCLUDE_SEM ? 'enabled' : 'disabled');
  if (VERBOSE) info('Verbose logging enabled');
  try {
    // Load YAML
    const yamlCtx = loadYamlContext(YML_PATH);

    // Validate primary_alias presence early
    for (const [fq, t] of yamlCtx.tables.entries()) {
      if (!t.primary_alias) throw new Error(`no alias for table ${fq}`);
    }

    // Snapshot DB
    const dbSnap = await snapshotDb(SCHEMA);

    // Merge
    const merged = mergeYamlIntoDb(yamlCtx, dbSnap, LOG_OUT);

    // Log YAML-only tables/cols
    for (const [fq] of yamlCtx.tables.entries()) {
      if (!dbSnap.tables.has(fq)) delta.push(`[DROP] YAML table not in DB: ${fq}`);
    }


    // Build minified prompt strings
    const minified = buildMinified(merged);

    if (merged.logs && merged.logs.length) delta.push(...merged.logs);
    if (delta.length) appendLog(delta, LOG_OUT);


    // ---- Build ENHANCED PROMPT from YAML + discovered schema ----
    const sectionsCfg = (yamlCtx?._raw?.generation?.sections) || (yamlCtx?.generation?.sections) || {};
    const { text: promptText, sectionTokens } = assemblePrompt({ yamlCtx, merged, minified, sectionsCfg });
    fs.writeFileSync(PROMPT_OUT, promptText);

    // ---- Console Output per YAML generation.output flags ----
    const outCfg = (yamlCtx?._raw?.generation?.output) || (yamlCtx?.generation?.output) || {};
    const incTok = !!outCfg.include_token_count;
    const incBreak = !!outCfg.include_section_breakdown;

    console.log(`\u2713 Generated enhanced prompt: ${PROMPT_OUT}`);
    console.log(`\u2713 Tables: ${merged.tables.length}, Hard joins: ${merged.joins.hard.length}, Soft joins: ${merged.joins.soft.length}`);

    if (incTok) {
      await ensureTokenizer();
      const total = countTokensApprox(promptText);
      console.log(`\u2713 Total tokens: ${total}`);
      if (incBreak) {
        console.log('Token breakdown:');
        for (const k of Object.keys(sectionTokens)) {
          console.log(`  ${k}: ${sectionTokens[k]} tokens`);
        }
      }
    }

  } catch (err) {
    // Also log errors to delta.log
    appendLog([`[ERROR] ${err?.message || err}`], LOG_OUT);
    console.error('Schema snapshot (merged) failed:', err?.message || err);
    process.exit(1);
  }
})();


