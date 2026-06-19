// extract-context.mjs
// Usage:
//   DATABASE_URL=postgresql://user:pass@host:5432/db node extract-context.mjs
//   # or rely on fallback below
// Optional:
//   OUTFILE=context.txt INCLUDE_NULLABILITY=true MAX_COLS_PER_TABLE=0 DEFAULT_ALIAS_LEN=3

  
import fs from 'fs';
import yaml from 'js-yaml';
import pkg from 'pg';
const { Client } = pkg;

// ===== CONFIG ===

const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  user: process.env.DB_USER || 'indexer',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'indexer'
};
const INPUT_MANUAL_SCHEMA = './db-context.yml';
const OUTPUT_FULL_SCHEMA = './full-context-schema.yml';
const OUTPUT_MINIFIED_SCHEMA = './minified-schema.txt';

// ===== SQL QUERIES =====
const COLUMNS_QUERY = `
SELECT
  table_name,
  column_name,
  data_type
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
`;

const PK_QUERY = `
SELECT
  kcu.table_name,
  kcu.column_name
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
WHERE tc.constraint_type = 'PRIMARY KEY'
  AND tc.table_schema = 'public';
`;

const FK_QUERY = `
SELECT
  kcu.table_name AS from_table,
  kcu.column_name AS from_column,
  ccu.table_name AS to_table,
  ccu.column_name AS to_column
FROM information_schema.table_constraints tc
JOIN information_schema.key_column_usage kcu
  ON tc.constraint_name = kcu.constraint_name
JOIN information_schema.constraint_column_usage ccu
  ON ccu.constraint_name = tc.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public';
`;

// ===== MAIN FUNCTION =====
async function main() {
  const client = new Client(DB_CONFIG);
  await client.connect();

  const [columnsRes, pkRes, fkRes] = await Promise.all([
    client.query(COLUMNS_QUERY),
    client.query(PK_QUERY),
    client.query(FK_QUERY)
  ]);

  await client.end();

  const columnsMap = {};
  columnsRes.rows.forEach(({ table_name, column_name, data_type }) => {
    if (!columnsMap[table_name]) columnsMap[table_name] = {};
    columnsMap[table_name][column_name] = data_type;
  });

  const pkMap = {};
  pkRes.rows.forEach(({ table_name, column_name }) => {
    if (!pkMap[table_name]) pkMap[table_name] = new Set();
    pkMap[table_name].add(column_name);
  });

  const fkMap = {};
  fkRes.rows.forEach(({ from_table, from_column, to_table, to_column }) => {
    if (!fkMap[from_table]) fkMap[from_table] = {};
    fkMap[from_table][from_column] = { to_table, to_column };
  });

  // Load manual schema
  const manualSchema = yaml.load(fs.readFileSync(INPUT_MANUAL_SCHEMA, 'utf8'));

  // Merge PK/FK into manual schema
  Object.keys(columnsMap).forEach(table => {
    const fullTableName = `public.${table}`;
    if (!manualSchema[fullTableName]) {
      manualSchema[fullTableName] = { columns: [] };
    }
    manualSchema[fullTableName].columns = Object.entries(columnsMap[table]).map(
      ([col, type]) => {
        let colDesc = `${col}:${shortType(type)}`;
        if (pkMap[table]?.has(col)) colDesc += ' PK';
        if (fkMap[table]?.[col]) {
          const { to_table, to_column } = fkMap[table][col];
          colDesc += ` FK→${to_table}.${to_column}`;
        }
        return colDesc;
      }
    );
  });

  // Save full-context schema
  fs.writeFileSync(OUTPUT_FULL_SCHEMA, yaml.dump(manualSchema, { sortKeys: false }), 'utf8');

  // Generate minified schema
  const minifiedLines = Object.keys(columnsMap).map(table => {
    const cols = Object.entries(columnsMap[table]).map(([col, type]) => {
      let colDesc = `${col}:${shortType(type)}`;
      if (pkMap[table]?.has(col)) colDesc += ' PK';
      if (fkMap[table]?.[col]) {
        const { to_table, to_column } = fkMap[table][col];
        colDesc += ` FK→${to_table}.${to_column}`;
      }
      return colDesc;
    });
    return `${table}(${cols.join(', ')})`;
  });

  fs.writeFileSync(OUTPUT_MINIFIED_SCHEMA, minifiedLines.join('\n'), 'utf8');

  console.log(`✅ Saved ${OUTPUT_FULL_SCHEMA} and ${OUTPUT_MINIFIED_SCHEMA}`);
}

// Shorten type names for token efficiency
function shortType(type) {
  return type
    .replace(/character varying.*/i, 'text')
    .replace(/timestamp.*/i, 'ts')
    .replace(/integer/i, 'int')
    .replace(/bigint/i, 'bigint')
    .replace(/numeric/i, 'num')
    .replace(/uuid/i, 'uuid')
    .replace(/boolean/i, 'bool')
    .replace(/jsonb?/i, 'json');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
