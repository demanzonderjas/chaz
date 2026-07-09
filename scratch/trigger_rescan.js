import { createClient } from '@libsql/client';
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });

async function run() {
  const rs = await turso.execute("SELECT id FROM games");
  let total = 0;
  const promises = [];
  for (const row of rs.rows) {
    promises.push(
      fetch('http://localhost:3000/api/puzzles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: row.id })
      }).then(r => r.json()).then(data => {
        total += data.count || 0;
        if (data.count > 0) process.stdout.write('+');
      }).catch(e => {
        // ignore
      })
    );
    if (promises.length >= 10) {
      await Promise.all(promises);
      promises.length = 0;
    }
  }
  await Promise.all(promises);
  console.log("\nDone! Total new puzzles:", total);
}
run();
