import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const rs = await client.execute(`
    SELECT fen_norm, result_json 
    FROM analysis 
    WHERE fen_norm LIKE '% b %' 
    LIMIT 10
  `);
  
  for (const row of rs.rows) {
    const res = JSON.parse(row.result_json);
    console.log(`FEN: ${row.fen_norm}`);
    console.log(`Stored cp: ${res.cp}, Stored mate: ${res.mate}`);
    console.log('---');
  }
}

run().catch(console.error);
