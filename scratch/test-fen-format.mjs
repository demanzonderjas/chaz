import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  try {
    const rs = await client.execute("SELECT fen_before, fen_after FROM book_moves LIMIT 3");
    console.log("FENS in book_moves:", rs.rows);
  } catch (e) {
    console.error(e);
  } finally {
    client.close();
  }
}

run();
