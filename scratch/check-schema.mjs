import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table'");
  console.log("Tables:", tables.rows.map(r => r.name));
  
  for (const table of tables.rows.map(r => r.name)) {
    const info = await client.execute(`PRAGMA table_info(${table})`);
    console.log(`Schema for ${table}:`, info.rows.map(c => `${c.name} (${c.type})`));
  }
}
run().catch(console.error);
