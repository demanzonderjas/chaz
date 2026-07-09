import { createClient } from '@libsql/client';
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
async function run() {
  const rs = await turso.execute("SELECT result_json FROM analysis WHERE result_json LIKE '%mate%' LIMIT 1");
  console.log(rs.rows[0].result_json);
}
run();
