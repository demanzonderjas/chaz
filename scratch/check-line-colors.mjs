import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const rs = await client.execute(`
    SELECT bm.line_id, bl.name, bl.color as line_color, SUBSTR(bm.fen_before, INSTR(bm.fen_before, ' ') + 1, 1) as turn_color, COUNT(*) as cnt
    FROM book_moves bm
    JOIN book_lines bl ON bm.line_id = bl.id
    GROUP BY bm.line_id, line_color, turn_color
    LIMIT 20
  `);

  console.log("Samples of book line colors vs turn colors:");
  rs.rows.forEach(r => {
    console.log(`Line ${r.line_id} (${r.name}): Line color = '${r.line_color}', Turn color = '${r.turn_color}', Count = ${r.cnt}`);
  });

  const mismatches = await client.execute(`
    SELECT COUNT(*) as cnt
    FROM book_moves bm
    JOIN book_lines bl ON bm.line_id = bl.id
    WHERE bl.color IS NOT NULL AND bl.color != '' AND SUBSTR(bm.fen_before, INSTR(bm.fen_before, ' ') + 1, 1) != bl.color
  `);
  console.log(`\nTotal mismatching rows in book_moves (where FEN turn color != line color): ${mismatches.rows[0].cnt}`);

  client.close();
}

run().catch(console.error);
