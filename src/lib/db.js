'use strict';
const { Pool } = require('pg');

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.DB_POOL_MAX) || 10 });

/** Run fn(client) in a transaction. */
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { pool, tx, query: (text, params) => pool.query(text, params) };
