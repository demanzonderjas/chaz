import { createClient } from '@libsql/client';
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run() {
  await turso.execute("DELETE FROM puzzles");
  console.log("All puzzles deleted!");
}
run();
