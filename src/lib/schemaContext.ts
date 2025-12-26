// src/lib/schemaContext.ts

/** A small column shape the LLM (and validators) can read */
export type TableColumn = {
  name: string;
  type: string;
  nullable: boolean;
  default?: string | null;
};

type TableSpec = {
  pk?: string | string[];         // suggested/known primary key(s)
  timeColumns?: string[];         // helps add time guards
  columns: TableColumn[];
};

/** Default allowed tables from your schema (lowercased) */
const allowedTablesDefault = [
  'public.block',
  'public.tx',
  'public.smart_contract',
  'public.chain_conf',
  'public.epoch_schedule',
  'public.epoch_committee_stat',
  'public.epoch_committee_stage',
  'public.validator',
  'public.validator_metadata',
  'public.validator_identity',
  'public.v_validator_uptime',
  'public.validator_registrations_stat',
] as const;

/** Merge env allow‑list with defaults */
export const allowedTables = Array.from(
  new Set(
    [
      ...(process.env.ALLOWED_TABLES ?? '')
        .split(',')
        .map(s => s.trim().toLowerCase())
        .filter(Boolean),
      ...allowedTablesDefault,
    ].map(s => s.toLowerCase())
  )
);

/** Canonical aliases to keep SQL tidy */
export const aliasHints: Record<string, string> = {
  'public.block': 'b',
  'public.tx': 't',
  'public.smart_contract': 'sc',
  'public.chain_conf': 'cc',
  'public.epoch_schedule': 'es',
  'public.epoch_committee_stat': 'ecs',
  'public.epoch_committee_stage': 'ecst',
  'public.validator': 'v',
  'public.validator_metadata': 'vm',
  'public.validator_identity': 'vi',
  'public.v_validator_uptime': 'vu',
  'public.validator_registrations_stat': 'vrs',
};

/** Full column lists (from your schema) */
export const tableSpecs: Record<string, TableSpec> = {
  'public.block': {
    pk: 'block_hash',
    timeColumns: ['time'],
    columns: [
      { name: 'block_hash',       type: 'bytea',                    nullable: false },
      { name: 'height',           type: 'integer',                  nullable: false },
      { name: 'protocol_version', type: 'text',                     nullable: true  },
      { name: 'slot_no',          type: 'bigint',                   nullable: true  },
      { name: 'epoch_no',         type: 'integer',                  nullable: true  },
      { name: 'time',             type: 'timestamptz',              nullable: false },
      { name: 'prev_hash',        type: 'bytea',                    nullable: true  },
      { name: 'tx_count',         type: 'integer',                  nullable: false },
      { name: 'size',             type: 'integer',                  nullable: true  },
      { name: 'fee_dust',         type: 'bigint',                   nullable: true  },
      { name: 'aura_pub_key',     type: 'text',                     nullable: false },
    ],
  },

  'public.chain_conf': {
    pk: 'id',
    columns: [
      { name: 'id',                      type: 'smallint',  nullable: false, default: '1' },
      { name: 'epoch_no_reference',      type: 'integer',   nullable: false },
      { name: 'cardano_epoch_no_reference', type: 'integer',nullable: false },
      { name: 'slot_per_epoch',          type: 'integer',   nullable: false },
      { name: 'slot_duration',           type: 'integer',   nullable: false },
      { name: 'network_magic',           type: 'integer',   nullable: true  },
      { name: 'cardano_epoch_duration',  type: 'integer',   nullable: false },
      { name: 'cardano_next_epoch_ms',   type: 'bigint',    nullable: true  },
      { name: 'next_epoch_time_ms',      type: 'bigint',    nullable: true  },
    ],
  },

  'public.epoch_committee_stage': {
    columns: [
      { name: 'epoch_no',        type: 'integer', nullable: false },
      { name: 'sidechain_pub_key', type: 'text',  nullable: false },
      { name: 'position',        type: 'integer', nullable: false },
    ],
  },

  'public.epoch_committee_stat': {
    columns: [
      { name: 'epoch_no',        type: 'integer', nullable: false },
      { name: 'aura_pub_key',    type: 'text',    nullable: false },
      { name: 'expected_blocks', type: 'integer', nullable: false },
      { name: 'produced_blocks', type: 'integer', nullable: false },
    ],
  },

  'public.epoch_schedule': {
    pk: 'epoch_no',
    timeColumns: ['start_ts', 'end_ts'],
    columns: [
      { name: 'epoch_no',         type: 'integer',     nullable: false },
      { name: 'cardano_epoch_no', type: 'integer',     nullable: false },
      { name: 'start_ts',         type: 'timestamptz', nullable: false },
      { name: 'end_ts',           type: 'timestamptz', nullable: false },
      { name: 'start_height',     type: 'bigint',      nullable: false },
      { name: 'end_height',       type: 'bigint',      nullable: false },
    ],
  },

  'public.smart_contract': {
    pk: 'contract_addr',
    columns: [
      { name: 'contract_addr',     type: 'text',   nullable: false },
      { name: 'deploy_total',      type: 'bigint', nullable: true,  default: '0' },
      { name: 'call_total',        type: 'bigint', nullable: true,  default: '0' },
      { name: 'update_total',      type: 'bigint', nullable: true,  default: '0' },
      { name: 'last_tx_index',     type: 'bigint', nullable: true  },
      { name: 'last_block_height', type: 'bigint', nullable: true  },
    ],
  },

  'public.tx': {
    pk: ['tx_hash', 'block_hash'], // you upsert on (tx_hash, block_hash)
    timeColumns: ['timestamp'],
    columns: [
      { name: 'tx_hash',         type: 'bytea',      nullable: false },
      { name: 'block_hash',      type: 'bytea',      nullable: false },
      { name: 'block_height',    type: 'integer',    nullable: false },
      { name: 'index_in_block',  type: 'smallint',   nullable: false },
      { name: 'status_reason',   type: 'text',       nullable: true  },
      { name: 'timestamp',       type: 'timestamptz',nullable: false },
      { name: 'fee_dust',        type: 'bigint',     nullable: false },
      { name: 'merkle_tree_root',type: 'bytea',      nullable: true  },
      // New counters you added:
      { name: 'deploy_count',    type: 'integer',    nullable: false, default: '0' },
      { name: 'update_count',    type: 'integer',    nullable: false, default: '0' },
      { name: 'call_count',      type: 'integer',    nullable: false, default: '0' },
    ],
  },

  'public.v_validator_uptime': {
    columns: [
      { name: 'aura_pub_key',   type: 'text',            nullable: true  },
      { name: 'produced',       type: 'bigint',          nullable: true  },
      { name: 'expected',       type: 'bigint',          nullable: true  },
      { name: 'alltime_uptime', type: 'numeric',         nullable: true  },
      { name: 'live_stake',     type: 'bigint',          nullable: true  },
      { name: 'live_saturation',type: 'double precision',nullable: true  },
      { name: 'live_delegators',type: 'integer',         nullable: true  },
      { name: 'valid',          type: 'boolean',         nullable: true  },
      { name: 'type',           type: 'text',            nullable: true  },
    ],
  },

  'public.validator': {
    pk: 'aura_pub_key',
    columns: [
      { name: 'aura_pub_key',                 type: 'text',            nullable: false },
      { name: 'registered_on_cardano_epoch',  type: 'integer',         nullable: true  },
      { name: 'live_stake',                   type: 'bigint',          nullable: true  },
      { name: 'live_saturation',              type: 'double precision',nullable: true  },
      { name: 'live_delegators',              type: 'integer',         nullable: true  },
      { name: 'active_stake',                 type: 'bigint',          nullable: true  },
      { name: 'declared_pledge',              type: 'bigint',          nullable: true  },
      { name: 'live_pledge',                  type: 'bigint',          nullable: true  },
      { name: 'margin_cost',                  type: 'double precision',nullable: true  },
      { name: 'fixed_cost',                   type: 'bigint',          nullable: true  },
      { name: 'valid',                        type: 'boolean',         nullable: true, default: 'true' },
      { name: 'type',                         type: 'text',            nullable: false },
    ],
  },

  'public.validator_identity': {
    pk: 'aura_pub_key',
    columns: [
      { name: 'aura_pub_key',     type: 'text',  nullable: false },
      { name: 'sidechain_pub_key',type: 'text',  nullable: true  },
      { name: 'mainchain_pub_key',type: 'text',  nullable: true  },
      { name: 'cardano_pool_hex', type: 'bytea', nullable: true  },
      { name: 'cardano_pool_id',  type: 'text',  nullable: true  },
    ],
  },

  'public.validator_metadata': {
    pk: 'aura_pub_key',
    columns: [
      { name: 'aura_pub_key', type: 'text',       nullable: false },
      { name: 'url',          type: 'text',       nullable: true  },
      { name: 'ticker',       type: 'text',       nullable: true  },
      { name: 'name',         type: 'text',       nullable: true  },
      { name: 'description',  type: 'text',       nullable: true  },
      { name: 'homepage',     type: 'text',       nullable: true  },
      { name: 'updated_at',   type: 'timestamptz',nullable: false, default: 'now()' },
    ],
  },

  'public.validator_registrations_stat': {
    columns: [
      { name: 'cardano_epoch_no',        type: 'integer',         nullable: false },
      { name: 'federated_valid_count',   type: 'integer',         nullable: false, default: '0' },
      { name: 'federated_invalid_count', type: 'integer',         nullable: false, default: '0' },
      { name: 'registered_valid_count',  type: 'integer',         nullable: false, default: '0' },
      { name: 'registered_invalid_count',type: 'integer',         nullable: false, default: '0' },
      { name: 'dparam',                  type: 'double precision',nullable: true  },
    ],
  },
};

/** Approved joins (same as before, now with alias hints) */
export const joins = [
  { from: 'public.tx', to: 'public.block', on: 't.block_hash = b.block_hash', aliasFrom: 't', aliasTo: 'b', preferred: true,  note: 'Transactions → block by hash (canonical).' },
  { from: 'public.tx', to: 'public.block', on: 't.block_height = b.height',   aliasFrom: 't', aliasTo: 'b', preferred: false, note: 'Fallback by height (ensure uniqueness in window).' },

  { from: 'public.block', to: 'public.epoch_schedule', on: 'b.epoch_no = es.epoch_no', aliasFrom: 'b', aliasTo: 'es', preferred: true, note: 'Block → epoch.' },

  { from: 'public.validator', to: 'public.validator_metadata', on: 'v.aura_pub_key = vm.aura_pub_key', aliasFrom: 'v', aliasTo: 'vm', preferred: true, note: 'Validator → metadata.' },
  { from: 'public.validator', to: 'public.validator_identity', on: 'v.aura_pub_key = vi.aura_pub_key', aliasFrom: 'v', aliasTo: 'vi', preferred: true, note: 'Validator → identity.' },
  { from: 'public.validator', to: 'public.v_validator_uptime', on: 'v.aura_pub_key = vu.aura_pub_key', aliasFrom: 'v', aliasTo: 'vu', preferred: true, note: 'Validator → uptime view.' },

  { from: 'public.epoch_committee_stat',  to: 'public.validator',       on: 'ecs.aura_pub_key = v.aura_pub_key', aliasFrom: 'ecs', aliasTo: 'v',  preferred: true, note: 'Committee stats → validator.' },
  { from: 'public.epoch_committee_stat',  to: 'public.epoch_schedule',  on: 'ecs.epoch_no = es.epoch_no',       aliasFrom: 'ecs', aliasTo: 'es', preferred: true, note: 'Committee stats → epoch.' },
  { from: 'public.epoch_committee_stage', to: 'public.validator_identity', on: 'ecst.sidechain_pub_key = vi.sidechain_pub_key', aliasFrom: 'ecst', aliasTo: 'vi', preferred: true, note: 'Committee stage → validator identity.' },
  { from: 'public.epoch_committee_stage', to: 'public.epoch_schedule',  on: 'ecst.epoch_no = es.epoch_no', aliasFrom: 'ecst', aliasTo: 'es', preferred: true, note: 'Committee stage → epoch.' },

  { from: 'public.validator_registrations_stat', to: 'public.epoch_schedule', on: 'vrs.cardano_epoch_no = es.cardano_epoch_no', aliasFrom: 'vrs', aliasTo: 'es', preferred: true, note: 'Registration stats → Cardano epoch.' },

  // smart_contract is a rollup table (standalone). Do not join to tx without a bridge table.
] as const;

/** Build a compact, LLM‑friendly schema doc (one string per table) */
export function schemaDocs(): string[] {
  const lines: string[] = [];
  for (const table of allowedTables) {
    const spec = tableSpecs[table];
    if (!spec) continue;
    const alias = aliasHints[table] ? ` AS ${aliasHints[table]}` : '';
    lines.push(`Table ${table}${alias}`);
    if (spec.pk) {
      lines.push(`  PK: ${Array.isArray(spec.pk) ? spec.pk.join(', ') : spec.pk}`);
    }
    if (spec.timeColumns?.length) {
      lines.push(`  Time columns: ${spec.timeColumns.join(', ')}`);
    }
    lines.push('  Columns:');
    for (const c of spec.columns) {
      const nn = c.nullable ? '' : ' NOT NULL';
      const def = c.default ? ` DEFAULT ${c.default}` : '';
      lines.push(`    - ${c.name} ${c.type}${nn}${def}`);
    }
    lines.push('');
  }
  return lines;
}

/** Hand the model strict rules (includes tables/joins and guidance) */
const tz = process.env.TIMEZONE ?? 'Europe/Paris';
export const systemRules = `
You are an assistant that writes PostgreSQL SELECT queries for our dataset.

HARD RULES
- SELECT-only. Never modify data (no DDL/DML/transactions).
- Output exactly one SQL statement with NO trailing semicolon.
- Always include LIMIT and OFFSET placeholders ($1, $2) unless the user explicitly asks for all results.
- Qualify tables with schema and use these short aliases:
  ${Object.entries(aliasHints).map(([t,a]) => `• ${t} AS ${a}`).join('\n  ')}
- Allowed tables: ${allowedTables.join(', ')}.
- Allowed joins (do not invent joins):
  ${joins.map(j => `• ${j.from} -> ${j.to} ON ${j.on} ${j.preferred ? '[preferred]' : ''} — ${j.note}`).join('\n  ')}
- Do NOT join public.smart_contract to tx without an explicit bridge (none exists in this schema).

TIME
- When grouping by day, use date_trunc('day', <time_col> AT TIME ZONE '${tz}').
- Prefer b."time" for block/day rollups; t."timestamp" for pure tx timelines.
- If user gives no time filter and a time column exists, assume a default window (last 30 days).

OUTPUT
- Return JSON only: {"sql":"...", "assumptions":["..."]}.
- Use clear aliases for computed columns (e.g., ratio_call_vs_total).
` as const;
