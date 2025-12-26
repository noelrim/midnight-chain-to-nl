import { Pool } from 'pg';

export const pool = new Pool({
  connectionString: process.env.PG_URL,
  application_name: 'midnight-nl-sql',
  max: 10,
  idleTimeoutMillis: 30_000,
});