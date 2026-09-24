const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    for (const name of readdirSync(resolve(__dirname, '../migrations')).filter((file) => /^\d+_.*\.sql$/.test(file)).sort()) {
      await client.query('BEGIN');
      try {
        const already = await client.query('SELECT 1 FROM schema_migrations WHERE name=$1',[name]);
        if (!already.rowCount) {
          await client.query(readFileSync(resolve(__dirname, '../migrations', name), 'utf8'));
          await client.query('INSERT INTO schema_migrations(name) VALUES($1)',[name]);
          console.log(`${name} applied`);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  } finally {
    await client.end();
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
