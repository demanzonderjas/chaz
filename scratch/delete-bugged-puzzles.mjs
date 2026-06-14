import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  console.log("Deleting puzzles with '(none)' solution...");
  const rs = await client.execute({
    sql: "DELETE FROM puzzles WHERE solution_uci = ? OR solution_san = ?",
    args: ["(none)", "(none)"]
  });
  console.log(`Successfully deleted ${rs.rowsAffected} bugged puzzles.`);
}

run().catch(console.error);
