// schema-snapshot.mjs
// Generate a compact schema snapshot (tables, columns, PKs, FKs, time candidates)
// Usage:
//   PG_URL=postgresql://user:pass@localhost:5432/db node schema-snapshot.mjs [outputPath] [schemaName]
// Defaults: outputPath="schema.json", schemaName="public"

import 'dotenv/config';
import { Pool } from 'pg';
import fs from 'fs';

const OUTPUT_PATH = process.argv[2] || 'schema.json';
const SCHEMA = (process.argv[3] || 'public').toLowerCase();

const pool = new Pool({
  connectionString: process.env.PG_URL
    || process.env.DATABASE_URL
    || 'postgresql://indexer:REDACTED@localhost:5432/indexer',
  application_name: 'schema-snapshot',
  max: 3,
});

function nowIso() { return new Date().toISOString(); }

async function main() {
  const client = await pool.connect();
  try {
    // 1) Columns (+ default/nullability)
    const colsQ = `
      SELECT
        c.table_schema,
        c.table_name,
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.ordinal_position
      FROM information_schema.columns c
      WHERE c.table_schema = $1
      ORDER BY c.table_schema, c.table_name, c.ordinal_position;
    `;
    const cols = await client.query(colsQ, [SCHEMA]);

    // 2) Primary keys
    const pksQ = `
      SELECT
        n.nspname   AS table_schema,
        rel.relname AS table_name,
        a.attname   AS column_name,
        a.attnum    AS attnum
      FROM pg_index i
      JOIN pg_class rel      ON rel.oid = i.indrelid
      JOIN pg_namespace n    ON n.oid   = rel.relnamespace
      JOIN unnest(i.indkey)  WITH ORDINALITY AS k(attnum, ord) ON TRUE
      JOIN pg_attribute a    ON a.attrelid = rel.oid AND a.attnum = k.attnum
      WHERE i.indisprimary = TRUE AND n.nspname = $1
      ORDER BY table_schema, table_name, k.ord;
    `;
    const pks = await client.query(pksQ, [SCHEMA]);

    // 3) Foreign keys (for join hints)
    const fksQ = `
      SELECT
        src_ns.nspname AS src_schema,
        src.relname    AS src_table,
        a_src.attname  AS src_col,
        tgt_ns.nspname AS tgt_schema,
        tgt.relname    AS tgt_table,
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
      WHERE con.contype = 'f'
        AND src_ns.nspname = $1
        AND tgt_ns.nspname = $1
      ORDER BY src.relname, k_src.ord;
    `;
    const fks = await client.query(fksQ, [SCHEMA]);

    // 4) Build table map
    const pkSet = new Set(
      pks.rows.map(r => `${r.table_schema}.${r.table_name}.${r.column_name}`.toLowerCase())
    );

    /** @type {Record<string, {schema:string, table:string, columns:any[], time_candidates?:string[]}>} */
    const tables = {};

    for (const r of cols.rows) {
      const key = `${r.table_schema}.${r.table_name}`.toLowerCase();
      if (!tables[key]) {
        tables[key] = {
          schema: r.table_schema,
          table: r.table_name,
          columns: [],
        };
      }
      tables[key].columns.push({
        name: r.column_name,
        type: r.data_type,
        nullable: r.is_nullable === 'YES',
        default: r.column_default ?? null,
        primary: pkSet.has(`${r.table_schema}.${r.table_name}.${r.column_name}`.toLowerCase()),
      });
    }

    // 5) Time column heuristics (helps default windows & grouping)
    for (const tbl of Object.values(tables)) {
      const cols = /** @type {{name:string,type:string}[]} */ (tbl.columns);
      const cands = cols
        .filter(c => /timestamp|time/i.test(c.type) || /(time|timestamp|date)/i.test(c.name))
        .map(c => c.name);
      tbl.time_candidates = cands;
    }

    // 6) FK join hints
    const joins = fks.rows.map(r => ({
      from: `${r.src_schema}.${r.src_table}`,
      to:   `${r.tgt_schema}.${r.tgt_table}`,
      from_col: r.src_col,
      to_col:   r.tgt_col,
      constraint: r.constraint_name,
      note: 'FK',
    }));

    // 7) Canonical convenience join (if present in your schema, keep it here).
    // If tx ↔ block isn't an FK, we can still hint it explicitly.
    // Safe to include; consumers may de-duplicate.
    const maybeTx = tables[`${SCHEMA}.tx`];
    const maybeBlock = tables[`${SCHEMA}.block`];
    if (maybeTx && maybeBlock) {
      joins.push({
        from: `${SCHEMA}.tx`,
        to:   `${SCHEMA}.block`,
        from_col: 'block_hash',
        to_col:   'block_hash',
        note: 'Canonical tx→block by block_hash',
      });
    }

    // 8) Final snapshot
    const snapshot = {
      generated_at: nowIso(),
      schema: SCHEMA,
      tables: Object.values(tables).sort((a, b) =>
        `${a.schema}.${a.table}`.localeCompare(`${b.schema}.${b.table}`)
      ),
      joins,
    };

    fs.writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2));
    console.log(`✓ Wrote ${OUTPUT_PATH}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error('Schema snapshot failed:', err?.message || err);
  process.exit(1);
});
