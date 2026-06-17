import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const tables = ['puzzles', 'puzzle_stats', 'games', 'book_moves', 'book_lines', 'position_moves'];
  for (const t of tables) {
    try {
      const schema = await client.execute(`PRAGMA table_info(${t})`);
      console.log(`Schema of ${t}:`);
      console.log(schema.rows.map(r => `${r.name} (${r.type})`).join(', '));
      
      const count = await client.execute(`SELECT COUNT(*) as cnt FROM ${t}`);
      console.log(`Count: ${count.rows[0].cnt}`);
      console.log('---');
    } catch (e) {
      console.error(`Error table ${t}:`, e.message);
    }
  }
}

run().catch(console.error);
