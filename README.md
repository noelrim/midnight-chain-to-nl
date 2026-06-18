# midnight-chain-to-nl

> A conversational natural-language-to-SQL interface for Midnight Network chain analytics — ask questions in plain English, get safe parameterized SQL, query results, and auto-generated charts.

Built on top of `midnight-chain-analytics-db` (the Postgres indexer for Midnight chain state), this app lets non-technical stakeholders self-serve analytics without writing SQL. The LLM translates natural language questions into vetted Postgres queries, executes them against the analytics database, and proposes the right chart for the result.

## What it does

- **Natural-language query planning** — user asks a question in plain English; the LLM returns structured JSON containing the proposed SQL, an acknowledgment of the request, key reasoning steps, a suggested follow-up question, and a chart specification.
- **Sandboxed SQL execution** — generated SQL passes through a multi-layer validation pipeline (SELECT-only, allowlist of tables, single-statement enforcement, mandatory `LIMIT`/`OFFSET`, 10-second statement timeout) before hitting Postgres.
- **Auto-generated visualizations** — the LLM proposes the chart shape (bar / line / area / stacked / point / pie / heatmap) along with the SQL; the app renders it via Chart.js, Vega-Lite, Plotly, or interactive grids depending on the data shape.
- **Conversational context** — session-aware chat with history, follow-up question suggestions, and conversation-aware planning so users can refine queries iteratively.
- **Interactive data exploration** — beyond the auto-chart, the results can be explored via AG Grid, pivot tables, Perspective (FINOS), and a drag-and-drop chart builder for ad-hoc inspection.

## Demo

[E2E Video Demo](https://drive.google.com/file/d/17zXknhXIHLRjNDWEDQURy3S13cO8xYSM/view?usp=sharing)

### Natural language query
*User asks a question about transaction history; the system generates SQL, executes it, and renders the appropriate chart. Data and visualization can be reconfigured with the chart controls.*

![NL2SQL Demo — transaction history](docs/demo1.png)

### Conversational follow-up with deep search
*User asks a complex follow-up about transaction spikes. The LLM performs a deep search and provides event-related answers to explain the behavior witnessed in the data (e.g. spikes tied to the Glacier Drop launch).*

![Conversational follow-up — transaction spike analysis](docs/demo2.png)

### Smart contract activity
*User asks for a view of smart contract activity per day alongside transaction counts. The system fetches on-chain data and renders an area chart with multiple series.*

![Smart contract activity per day](docs/demo3.png)

### SPO uptime and custom visualization
*User asks for SPO uptime data, then customizes the visualization through the drag-and-drop chart builder.*

![SPO uptime — custom visualization](docs/demo4.png)

## Architecture

```
┌─────────────────────────┐
│  Chat UI (Next.js)      │
└──────────┬──────────────┘
           │  user question
           ▼
┌─────────────────────────┐
│  /api/chat              │ — session storage, history merge
│  /api/nl-query          │ — single-shot NL planning
└──────────┬──────────────┘
           │  user text + history
           ▼
┌─────────────────────────┐
│  LLM Planner            │ — OpenAI with config-driven prompt
│  (lib/llm.ts)           │   from db-context.yml
└──────────┬──────────────┘
           │  { sql, assumptions, chart }
           ▼
┌─────────────────────────┐
│  SQL Validation         │ — normalize, SELECT-only,
│  (lib/validateSql.ts)   │   allowed tables, single-statement,
│                         │   LIMIT/OFFSET injection, time guards
└──────────┬──────────────┘
           │  safe SQL + params
           ▼
┌─────────────────────────┐
│  /api/run-sql           │ — Postgres pool, 10s timeout
└──────────┬──────────────┘
           │  rows
           ▼
┌─────────────────────────┐
│  Chart Renderer         │ — Chart.js / Vega-Lite / Plotly /
│  + Interactive Grid     │   AG Grid / Perspective / Pivot
└─────────────────────────┘
```

## Safety architecture for AI-generated SQL

LLM-generated SQL is inherently untrusted. The validation pipeline applies several layers before execution:

- **`normalizeSql`** strips comments and trailing semicolons
- **`ensureSelectOnly`** rejects any query containing `INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `CREATE`, `TRUNCATE`, `GRANT`, `REVOKE`, `COPY`, `CALL`, or `DO`
- **Single-statement guard** rejects any embedded semicolon outside string literals (prevents stacked statement injection)
- **`ensureAllowedTables`** parses `FROM`/`JOIN` clauses and rejects queries that reference tables outside the configured allowlist
- **`ensureLimit`** injects `LIMIT $1 OFFSET $2` as parameterized placeholders if the query lacks a LIMIT clause
- **`applyTimeGuard`** auto-inserts a 30-day `WHERE time >= NOW() - INTERVAL '30 days'` clause for time-series queries without an explicit time filter
- **Postgres `statement_timeout = '10s'`** set at the session level before execution

The pipeline assumes the LLM will occasionally produce unsafe SQL and prevents execution rather than relying on prompt instructions alone.

## Configurable prompt generation

The LLM prompt is generated from `db-context.yml`, which centralizes:

- **Database schema** — tables, columns, types, primary keys, time columns
- **Section toggles** — which prompt sections to include (core instructions, aliases, join rules, validation checklist, query analysis, time handling, common patterns, field mappings)
- **Token optimization** — hint caps per table, example inclusion, compact table format
- **Behavioral rules** — critical thinking steps, reasoning checklist, aggregation rules, schema adherence requirements, security constraints, join rules, output format

This separates prompt engineering from application code — changes to the prompt's structure or content go in YAML rather than TypeScript.

## Tech stack

- **Next.js 15** (App Router, Turbopack), **React 19**
- **OpenAI** for SQL planning
- **Postgres** (`pg` driver, connection pool)
- **Visualization**: Chart.js, Vega-Lite, Plotly, AG Grid, react-pivottable, FINOS Perspective
- **Validation**: Zod
- **Tokenization**: `@dqbd/tiktoken` for token counting
- **State**: React hooks + in-memory session storage

## Environment variables

```bash
PG_URL=postgresql://indexer:REDACTED@localhost:5432/indexer
OPENAI_API_KEY=<your OpenAI API key>
MAX_LIMIT=1000  # optional, default 1000
```

## Getting started

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) and ask a question against the chain analytics database.

Example questions:

- *"How many transactions per day in the last 30 days?"*
- *"Which validators were in the committee for epoch 42?"*
- *"Show the distribution of smart contract deployments by month"*
- *"Which Cardano pools registered as Midnight validators in the last 5 epochs?"*

## Context

This is the analytics frontend on top of `midnight-chain-analytics-db`. The companion repo handles real-time ingestion of Midnight chain state into Postgres; this repo provides the conversational analytics interface on top of that database.

Part of a broader set of Midnight Network tooling built while contributing to the mainnet launch — see also `midnight-explorer`, `midnight-mcp`, `asset_management`.

## Author

Noel Rimbert — [LinkedIn](https://www.linkedin.com/in/noelrimbert/)

## License

Apache License 2.0
