import { createClient } from '@libsql/client';
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
async function run() {
  const rs = await turso.execute("SELECT result_json FROM analysis WHERE multipv = 4 LIMIT 1");
  console.log(JSON.parse(rs.rows[0].result_json));
}
run();
