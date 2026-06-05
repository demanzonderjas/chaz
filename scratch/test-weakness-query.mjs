import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const sql = `
    SELECT COUNT(*) as count
    FROM position_moves pm
    JOIN analysis a ON a.fen_norm LIKE pm.fen_norm || '%'
    WHERE (pm.losses > pm.wins OR pm.losses >= 2)
      AND a.engine = 'sf18'
      AND json_extract(a.result_json, '$.bestMove') != pm.uci
  `;
  const rs = await client.execute(sql);
  console.log("Total weak positions with better engine moves:", rs.rows[0].count);
}
run().catch(console.error);
