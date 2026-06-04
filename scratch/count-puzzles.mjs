import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const rs = await client.execute("SELECT type, COUNT(*) as count FROM puzzles GROUP BY type");
  console.log("Puzzles count by type:");
  console.log(rs.rows);
}
run().catch(console.error);
