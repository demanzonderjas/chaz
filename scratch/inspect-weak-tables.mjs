import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const pmRs = await client.execute("SELECT * FROM position_moves LIMIT 3");
  console.log("position_moves samples:");
  console.log(pmRs.rows);

  const aRs = await client.execute("SELECT fen_norm, engine, limit_type FROM analysis LIMIT 3");
  console.log("analysis samples:");
  console.log(aRs.rows);
}
run().catch(console.error);
