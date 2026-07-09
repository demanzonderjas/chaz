import { createClient } from '@libsql/client';
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
async function run() {
  const rs = await turso.execute("SELECT multipv, COUNT(*) as c FROM analysis GROUP BY multipv");
  console.log(rs.rows);
}
run();
