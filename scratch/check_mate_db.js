import { createClient } from '@libsql/client';
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
async function run() {
  const rs = await turso.execute("SELECT result_json FROM analysis WHERE result_json LIKE '%mate:%' LIMIT 5");
  console.log(rs.rows.map(r => JSON.parse(r.result_json)));
}
run();
