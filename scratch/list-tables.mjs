import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const rs = await client.execute("SELECT name, sql FROM sqlite_master WHERE type='table'");
  for (const r of rs.rows) {
    console.log(`Table: ${r.name}`);
    console.log(r.sql);
    console.log('---');
  }
}
run().catch(console.error);
