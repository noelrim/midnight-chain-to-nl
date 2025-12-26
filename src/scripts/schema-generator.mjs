// enhanced-schema-generator.mjs
// Complete integrated version building on your existing schema-snapshot.mjs
// Generates optimized NL2SQL prompts from YAML config + DB schema

import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';
import crypto from 'crypto';
import yaml from 'js-yaml';

// ---- Enhanced logging (from your original) ----
const VERBOSE = process.argv.includes('--verbose') || process.env.VERBOSE === '1';
const ts = () => new Date().toISOString();
const log = (lvl, ...args) => { if (lvl === 'debug' && !VERBOSE) return; console.log(`[${ts()}] [${lvl.toUpperCase()}]`, ...args); };
const info = (...a) => log('info', ...a);
const warn = (...a) => log('warn', ...a);
const error = (...a) => log('error', ...a);
const debug = (...a) => log('debug', ...a);

// ---- CLI & ENV (enhanced) ----
const args = process.argv.filter(arg => !arg.startsWith('--'));
const SCHEMA = (args[2] || 'public').toLowerCase();
const JSON_OUT = args[3] || 'context-llm.json';
const LLM_OUT = args[4] || 'enhanced-prompt.txt';
const LOG_OUT = args[5] || 'generation.log';
const YML_PATH = process.env.CONTEXT_YML || './db-context.yml';

// ---- PG POOL (from your original) ----
const CONN_STR = process.env.PG_URL || process.env.DATABASE_URL || 'postgresql://indexer:REDACTED@localhost:5432/indexer';
const CONN_TIMEOUT = parseInt(process.env.PG_CONNECT_TIMEOUT_MS || '8000', 10);
const STMT_TIMEOUT = parseInt(process.env.PG_STATEMENT_TIMEOUT_MS || '15000', 10);

function redactUrl(u) {
  try { 
    const url = new URL(u); 
    if (url.password) url.password = '***'; 
    return url.toString(); 
  } catch { 
    return u.replace(/:(?:[^@]+)@/, '://***@'); 
  }
}

const pool = new Pool({
  connectionString: CONN_STR,
  application_name: 'enhanced-schema-generator',
  max: 3,
  connectionTimeoutMillis: CONN_TIMEOUT,
});

// ---- Utils (from your original) ----
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
  return s.replace(/\\s+/g, '_');
};

const SKIP_RE = /\\b(skip|ignore)\\b/i;

function appendLog(lines, path) {
  try { fs.appendFileSync(path, lines.join('\n') + '\n'); } catch {}
}

// ---- YAML Context Loader (from your original) ----
function loadYamlContext(path) {
  const src = fs.readFileSync(path, 'utf8');
  const y = yaml.load(src) || {};
  
  const tables = new Map();
  for (const [k, v] of Object.entries(y)) {
    if (k.startsWith('_')) continue;
    const fq = String(k).toLowerCase();
    if (!fq.includes('.')) continue;
    const t = v || {};
    
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
      reasoning_hints: Array.isArray(t.reasoning_hints) ? t.reasoning_hints.filter(Boolean) : [],
      soft_join_keys: Array.isArray(t.soft_join_keys) ? t.soft_join_keys.filter(Boolean) : [],
      raw: t,
    });
  }
  
  const rules = y.rules || null;
  const alias_groups = y._alias_groups || null;
  const generation = y.generation || {};
  const analysis_patterns = y.analysis_patterns || {};
  const validation = y.validation || {};
  
  return { tables, rules, alias_groups, generation, analysis_patterns, validation, _raw: y };
}

// ---- DB Snapshot (from your original) ----
async function snapshotDb(schema) {
  const client = await pool.connect();
  try {
    info('Connecting to Postgres…');
    await client.query(`SET statement_timeout = ${STMT_TIMEOUT}`);
    debug('SET statement_timeout ok');

    // Columns
    info('Querying columns…');
    const colsQ = `
      SELECT c.table_schema, c.table_name, c.column_name, c.data_type,
             c.is_nullable, c.column_default, c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema = $1
      ORDER BY c.table_schema, c.table_name, c.ordinal_position;`;
    const cols = await client.query(colsQ, [schema]);
    info('Columns rows:', cols.rowCount);

    // Primary keys
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

    // Foreign keys
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

    // Assemble tables
    const pkSet = new Set(pks.rows.map(r => toFQName(r.table_schema, r.table_name) + '.' + r.column_name.toLowerCase()));
    const tables = new Map();

    for (const r of cols.rows) {
      const fq = toFQName(r.table_schema, r.table_name);
      if (!tables.has(fq)) {
        tables.set(fq, { 
          schema: r.table_schema.toLowerCase(), 
          table: r.table_name.toLowerCase(), 
          columns: [] 
        });
      }
      tables.get(fq).columns.push({
        name: r.column_name.toLowerCase(),
        type: r.data_type,
        primary: pkSet.has(fq + '.' + r.column_name.toLowerCase()),
        ...(r.is_nullable === 'NO' ? { nullable: false } : {}),
        ...(r.column_default != null ? { default: r.column_default } : {}),
      });
    }
    info('DB tables found:', tables.size);

    // Hard joins
    const hard = [];
    for (const r of fks.rows) {
      hard.push({
        from: toFQName(r.src_schema, r.src_table),
        from_col: r.src_col.toLowerCase(),
        to: toFQName(r.tgt_schema, r.tgt_table),
        to_col: r.tgt_col.toLowerCase(),
        constraint: r.constraint_name,
        note: 'FK',
      });
    }

    // Canonical tx→block join if both exist
    const keyTx = toFQName(schema, 'tx');
    const keyBlock = toFQName(schema, 'block');
    if (tables.has(keyTx) && tables.has(keyBlock)) {
      hard.push({ 
        from: keyTx, 
        from_col: 'block_hash', 
        to: keyBlock, 
        to_col: 'block_hash', 
        constraint: null, 
        note: 'canonical' 
      });
    }

    info('Hard joins (FK+canonical):', hard.length);
    return { tables, hard };
  } finally {
    try { debug('Releasing client…'); client.release(); } catch {}
    debug('Ending pool…');
    await pool.end();
  }
}

// ---- Merge Logic (from your original, simplified) ----
function mergeYamlIntoDb(yamlCtx, dbSnap) {
  const logs = [];
  const yamlTables = yamlCtx.tables;
  
  // Filter DB tables to YAML-authoritative set
  const mergedTables = [];
  const allowedSet = new Set(yamlTables.keys());
  
  for (const [fq, t] of dbSnap.tables.entries()) {
    if (!allowedSet.has(fq)) continue;
    const y = yamlTables.get(fq);
    
    mergedTables.push({
      fqname: fq,
      schema: t.schema,
      table: t.table,
      primary_alias: y.primary_alias,
      columns: t.columns,
      aliases: y.aliases,
      semantic_tags: y.semantic_tags,
      query_hints: y.query_hints,
      reasoning_hints: y.reasoning_hints,
      soft_join_keys: y.soft_join_keys,
      raw: y.raw,
    });
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
  // deny regex (from YAML rules.joins_deny or top-level joins_deny)
  const denyRe = denyRegexFromYaml(yamlCtx); // reuse your helper if present

  const soft = inferSoftJoinsFromYaml(
    yamlTables,           // Map of YAML tables
    mergedTables,         // merged tables list (YAML-filtered)
    hard,                 // FK joins
    dbSnap.tables,        // DB tables/columns snapshot
    denyRe
  );

  return { tables: mergedTables, joins: { hard, soft }, logs };
}

// Put this near your other helpers (top of file)
function denyRegexFromYaml(yamlCtx) {
  // prefer rules.joins_deny, then top-level joins_deny, then rules.joins?.deny (just in case)
  let raw = yamlCtx?.rules?.joins_deny ?? yamlCtx?.joins_deny ?? yamlCtx?.rules?.joins?.deny ?? null;
  if (!raw || typeof raw !== 'string' || !raw.trim()) return null;

  raw = raw.trim();

  // Support both "fee_dust|update_total" and "/fee_dust|update_total/i"
  let pattern = raw;
  let flags = 'i';
  const m = raw.match(/^\/(.+)\/([gimsuy]*)$/);
  if (m) {
    pattern = m[1];
    flags = m[2] || 'i';
  }

  try {
    return new RegExp(pattern, flags);
  } catch (e) {
    // invalid regex in YAML — ignore and continue without a deny filter
    if (yamlCtx?.logs) yamlCtx.logs.push(`WARN: Invalid joins_deny regex "${raw}" (${e.message})`);
    return null;
  }
}

// Build soft joins strictly from YAML soft_join_keys that exist in DB on both sides
  function inferSoftJoinsFromYaml(yamlTables, mergedTables, hardJoins, dbTables, denyRe) {
    const byFq = new Map(mergedTables.map(t => [t.fqname, t]));
    const fqList = mergedTables.map(t => t.fqname);

    // For each table, keep only soft keys that are real DB columns
    const tableKeys = new Map(); // fq -> Set(keys)
    for (const fq of fqList) {
      const t = byFq.get(fq);
      const dbCols = new Set((dbTables.get(fq)?.columns || []).map(c => c.name));
      const yamlKeys = new Set((t.soft_join_keys || []).map(k => String(k).toLowerCase()));
      const exist = new Set([...yamlKeys].filter(k => dbCols.has(k)));
      tableKeys.set(fq, exist);
    }

    // Index hard joins for quick suppression
    const hardSig = new Set(
      hardJoins.map(h => `${h.from}|${h.from_col}|${h.to}|${h.to_col}`)
    );

    const soft = [];
    const seen = new Set();
    for (let i = 0; i < fqList.length; i++) {
      for (let j = i + 1; j < fqList.length; j++) {
        const A = fqList[i], B = fqList[j];
        const keysA = tableKeys.get(A), keysB = tableKeys.get(B);
        if (!keysA.size || !keysB.size) continue;

        const shared = [...keysA].filter(k => keysB.has(k));
        for (const k of shared) {
          if (denyRe && denyRe.test(k)) continue; // obey joins_deny
          // skip if there's already a hard join on the same column pair (dir-agnostic)
          const s1 = `${A}|${k}|${B}|${k}`;
          const s2 = `${B}|${k}|${A}|${k}`;
          if (hardSig.has(s1) || hardSig.has(s2)) continue;

          const id = `${A}|${k}|${B}|${k}`;
          if (seen.has(id)) continue;
          seen.add(id);

          soft.push({ left: A, left_col: k, right: B, right_col: k, reason: 'yaml.soft_join_keys' });
        }
      }
    }
    return soft;
  }


// ---- Enhanced Section Builders ----
const getSectionConfig = (yamlCtx) => {
  const sections = yamlCtx?.generation?.sections || {};
  return {
    core_instructions: sections.core_instructions !== false,
    absolute_rules: sections.absolute_rules !== false,
    schema_adherence: sections.schema_adherence !== false,
    user_input_handling: sections.user_input_handling !== false,
    join_rules: sections.join_rules !== false,
    query_analysis: sections.query_analysis !== false,
    time_handling: sections.time_handling !== false,
    validation_checklist: sections.validation_checklist !== false,
    common_patterns: sections.common_patterns === true,
    field_mappings: sections.field_mappings === true,
  };
};

const buildCoreInstructions = (yamlCtx) => {
  const lines = [];
  lines.push('## Core Instructions');
  if (yamlCtx.rules?.role) {
    lines.push(`Role: ${yamlCtx.rules.role}`);
  }
  if (yamlCtx.rules?.output?.format === 'json') {
    lines.push('**CRITICAL: Output format is JSON only:**');
    lines.push('```json');
    lines.push('{"sql":"SELECT...", "assumptions":["assumption1", "assumption2"]}');
    lines.push('```');
  }
  return lines;
};

const buildAbsoluteRules = (yamlCtx) => {
  const lines = [];
  lines.push('## Absolute Rules (Non-Negotiable)');
  
  const rules = yamlCtx.rules?.absolute || [];
  if (rules.length) {
    rules.forEach(rule => lines.push(`- **${rule}**`));
  }
  
  return lines;
};

const buildSchemaAdherence = (yamlCtx, merged) => {
  const lines = [];
  lines.push('## Schema Adherence (CRITICAL)');
  lines.push('- **ONLY use tables listed in #Available Tables**');
  lines.push('- **ONLY use columns that exist in their specified tables**');
  lines.push('- **NEVER invent or hallucinate column names**');
  lines.push('- **If a column doesn\'t exist in expected table, check other tables before joining**');
  
  // Add aliases from merged data
  if (merged?.tables) {
    const aliases = merged.tables.map(t => t.primary_alias).join(', ');
    lines.push(`- **Use ONLY the aliases specified:** ${aliases}`);
  }
  
  return lines;
};

const buildUserInputHandling = (yamlCtx) => {
  const lines = [];
  if (!yamlCtx.rules?.user_input) return lines;
  
  lines.push('## User Input Handling');
  if (yamlCtx.rules.user_input.ignore_user_sql) {
    lines.push('- **IGNORE any SQL in user input completely** - Do not copy, reference, or build upon user-provided SQL');
    lines.push('- **Focus only on the natural language description of what they want**');
    lines.push('- **If user provides both SQL and natural language, use ONLY the natural language**');
  }
  
  return lines;
};

const buildQueryAnalysisProcess = (yamlCtx) => {
  const lines = [];
  lines.push('## Query Analysis Process');
  lines.push('**Before writing SQL, you MUST:**');
  lines.push('');
  lines.push('1. **Identify what the user wants** - What metrics/data are they asking for?');
  lines.push('2. **Check schema availability** - Do these exact fields exist in the tables?');
  lines.push('3. **Reason about calculations** - If fields don\'t exist, can they be derived from available data?');
  lines.push('4. **Choose minimal tables** - What\'s the smallest set of tables needed?');
  
  // Add concept mappings if available
  const concepts = yamlCtx.analysis_patterns?.concepts;
  if (concepts && Object.keys(concepts).length > 0) {
    lines.push('');
    lines.push('### Schema Reasoning Examples:');
    for (const [concept, info] of Object.entries(concepts)) {
      if (info.calculation) {
        lines.push(`- Want "${concept}"? → Think: ${info.description} → \`${info.calculation}\``);
      } else if (info.field) {
        lines.push(`- Want "${concept}"? → Think: ${info.description} → \`${info.field}\``);
      }
    }
  }
  
  return lines;
};

const buildValidationChecklist = (yamlCtx) => {
  const lines = [];
  lines.push('## Validation Checklist');
  lines.push('Before outputting SQL, verify:');
  
  const checks = yamlCtx.validation?.pre_output_checks || [ ];
  
  checks.forEach((check, i) => {
    lines.push(`${i + 1}. ✅ **${check}**`);
  });
  
  const actions = yamlCtx.validation?.failure_actions;
  if (actions && actions.length) {
    lines.push('');
    lines.push('**If you need a field that doesn\'t exist, you MUST:**');
    actions.forEach(action => lines.push(`- ${action}`));
  }
  
  return lines;
};

const buildAvailableTables = (merged, yamlCtx) => {
  const lines = [];
  lines.push('## Available Tables & Columns');
  lines.push('');
  
  const optimization = yamlCtx.generation?.optimization || {};
  const maxHints = optimization.max_hints_per_table || 3;
  
  for (const table of merged.tables) {
    lines.push(`### ${table.table} (alias: ${table.primary_alias})`);
    
    // Columns with type info
    const cols = table.columns.map(c => {
      let s = `${c.name}:${shortType(c.type)}`;
      if (c.primary) s += ' PK';
      return s;
    });
    lines.push(`**Columns:** ${cols.join(', ')}`);
    
    // Usage context and hints
    const context = table.raw?.usage_context;
    if (context?.primary_purpose) {
      lines.push(`**Use for:** ${context.primary_purpose}`);
    }
    
    const hints = table.reasoning_hints || table.query_hints || [];
    if (hints.length) {
      const limitedHints = hints.slice(0, maxHints);
      lines.push(`**Key points:** ${limitedHints.join(' | ')}`);
    }
    
    lines.push('');
  }
  
  return lines;
};

const buildJoinsSection = (merged) => {
  const lines = [];
  lines.push('## Approved Joins');
  lines.push('');
  
  const aliasOf = Object.fromEntries(merged.tables.map(t => [t.fqname, t.primary_alias]));
  
  if (merged.joins?.hard?.length) {
    lines.push('### Hard Joins (Exact matches)');
    for (const j of merged.joins.hard) {
      const fromAlias = aliasOf[j.from];
      const toAlias = aliasOf[j.to];
      lines.push(`- \`${fromAlias}.${j.from_col} = ${toAlias}.${j.to_col}\``);
    }
    lines.push('');
  }
  
  if (merged.joins?.soft?.length) {
    lines.push('### Soft Joins (Approximate matches)');
    for (const j of merged.joins.soft) {
      const leftAlias = aliasOf[j.left];
      const rightAlias = aliasOf[j.right];
      lines.push(`- \`${leftAlias}.${j.left_col} = ${rightAlias}.${j.right_col}\``);
    }
  }
  
  return lines;
};

const buildTimeHandling = (yamlCtx) => {
  const lines = [];
  if (!yamlCtx.rules?.time) return lines;
  
  lines.push('## Time Handling');
  const guidance = yamlCtx.rules.time.guidance || [];
  guidance.forEach(g => lines.push(`- ${g}`));
  lines.push(`- All times in UTC`); // Force UTC as per your original requirement
  
  return lines;
};

// ---- Main Assembly Function ----
const assembleEnhancedPrompt = (yamlCtx, merged) => {
  const sections = getSectionConfig(yamlCtx);
  const promptLines = [];
  const sectionStats = {};
  
  // Helper to add section with stats
  const addSection = (name, builder, ...args) => {
    if (!sections[name]) return;
    
    const startChars = promptLines.join('\n').length;
    const lines = builder(yamlCtx, merged, ...args);
    if (lines.length) {
      promptLines.push(...lines, '');
      const endChars = promptLines.join('\n').length;
      sectionStats[name] = {
        lines: lines.length,
        chars: endChars - startChars
      };
    }
  };
  
  // Build sections based on config
  addSection('core_instructions', buildCoreInstructions);
  addSection('absolute_rules', buildAbsoluteRules);
  addSection('schema_adherence', buildSchemaAdherence);
  addSection('user_input_handling', buildUserInputHandling);
  addSection('query_analysis', buildQueryAnalysisProcess);
  addSection('time_handling', buildTimeHandling);
  addSection('validation_checklist', buildValidationChecklist);
  
  // Always include tables and joins (core functionality)
  addSection('available_tables', buildAvailableTables, merged, yamlCtx);
  addSection('joins', buildJoinsSection, merged);
  
  // Example response format
  promptLines.push('## Example Response Format');
  promptLines.push('```json');
  promptLines.push('{');
  promptLines.push('  "sql": "SELECT va.aura_pub_key, vm.name, ecs.produced_blocks FROM epoch_committee_stat ecs JOIN validator va ON ecs.aura_pub_key = va.aura_pub_key LEFT JOIN validator_metadata vm ON va.aura_pub_key = vm.aura_pub_key WHERE ecs.epoch_no = 100 ORDER BY ecs.produced_blocks DESC LIMIT $1 OFFSET $2",');
  promptLines.push('  "assumptions": ["Using epoch 100 as example", "Including validator names where available"]');
  promptLines.push('}');
  promptLines.push('```');
  
  return { 
    prompt: promptLines.join('\n'),
    sectionStats
  };
};

// ---- Token Counting ----
const countTokens = async (text, sectionStats) => {
  try {
    const mod = await import('@dqbd/tiktoken');
    const enc = mod.encoding_for_model?.('gpt-4o') || mod.get_encoding?.('o200k_base');
    
    if (!enc) {
      warn('Token counting unavailable');
      return null;
    }
    
    const totalTokens = enc.encode(text).length;
    
    // Estimate section tokens based on character ratios
    const totalChars = text.length;
    const sectionTokens = {};
    for (const [section, stats] of Object.entries(sectionStats)) {
      const ratio = stats.chars / totalChars;
      sectionTokens[section] = Math.round(totalTokens * ratio);
    }
    
    if (enc.free) enc.free();
    
    return {
      total: totalTokens,
      sections: sectionTokens
    };
  } catch (e) {
    warn('Token counting failed (install @dqbd/tiktoken):', e.message);
    return null;
  }
};

// ---- Main Function ----
async function generateEnhancedPrompt() {
  const start = Date.now();
  info('Starting enhanced prompt generation');
  info('Schema:', SCHEMA);
  info('YAML:', YML_PATH);
  info('Outputs:', JSON_OUT, LLM_OUT);
  info('PG:', redactUrl(CONN_STR), `connTimeout=${CONN_TIMEOUT}ms`, `stmtTimeout=${STMT_TIMEOUT}ms`);
  if (VERBOSE) info('Verbose logging enabled');
  
  try {
    // Load YAML config
    const yamlCtx = loadYamlContext(YML_PATH);
    info('YAML loaded, sections config:', getSectionConfig(yamlCtx));
    
    // Validate primary_alias presence early
    for (const [fq, t] of yamlCtx.tables.entries()) {
      if (!t.primary_alias) throw new Error(`no alias for table ${fq}`);
    }
    
    // Get DB snapshot
    const dbSnap = await snapshotDb(SCHEMA);
    
    // Merge
    const merged = mergeYamlIntoDb(yamlCtx, dbSnap);
    
    // Generate enhanced prompt
    const { prompt, sectionStats } = assembleEnhancedPrompt(yamlCtx, merged);
    
    // Count tokens
    const tokenStats = await countTokens(prompt, sectionStats);
    
    // Write outputs
    fs.writeFileSync(LLM_OUT, prompt);
    
    const metadata = {
      generated_at: nowIso(),
      schema: SCHEMA,
      version: sha256(JSON.stringify({ schema: SCHEMA, timestamp: nowIso() })),
      sections: getSectionConfig(yamlCtx),
      stats: {
        sections: sectionStats,
        tokens: tokenStats,
        tables: merged.tables.length,
        hard_joins: merged.joins?.hard?.length || 0,
        soft_joins: merged.joins?.soft?.length || 0,
        generation_time_ms: Date.now() - start
      }
    };
    
    fs.writeFileSync(JSON_OUT, JSON.stringify(metadata, null, 2));
    
    console.log(`✓ Generated enhanced prompt: ${LLM_OUT}`);
    console.log(`✓ Metadata: ${JSON_OUT}`);
    console.log(`✓ Tables: ${merged.tables.length}, Hard joins: ${merged.joins?.hard?.length || 0}, Soft joins: ${merged.joins?.soft?.length || 0}`);
    
    if (tokenStats?.total) {
      console.log(`✓ Total tokens: ${tokenStats.total}`);
      
      if (VERBOSE && tokenStats.sections) {
        console.log('Token breakdown:');
        for (const [section, tokens] of Object.entries(tokenStats.sections)) {
          console.log(`  ${section}: ${tokens} tokens`);
        }
      }
    }
    
    const delta = merged.logs || [];
    if (delta.length) {
      appendLog(delta, LOG_OUT);
      console.log(`∆ See ${LOG_OUT} for details`);
    }
    
  } catch (err) {
    appendLog([`[ERROR] ${err?.message || err}`], LOG_OUT);
    error('Enhanced prompt generation failed:', err?.message || err);
    process.exit(1);
  }
}

// Run if main module
generateEnhancedPrompt();