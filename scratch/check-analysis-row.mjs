import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const rs = await client.execute("SELECT result_json FROM analysis LIMIT 1");
  if (rs.rows[0]) {
    console.log(JSON.stringify(JSON.parse(rs.rows[0].result_json), null, 2));
  } else {
    console.log("No analysis rows found.");
  }
}
run().catch(console.error);
