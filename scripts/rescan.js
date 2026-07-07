const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient({ url, authToken });

async function run() {
  console.log('Clearing old puzzles...');
  // Delete all non-book puzzles (weakness puzzles are not stored here anyway)
  await client.execute("DELETE FROM puzzles WHERE type != 'book'");
  
  console.log('Fetching games to rescan...');
  const rs = await client.execute('SELECT id FROM games ORDER BY id DESC');
  console.log(`Found ${rs.rows.length} games. Starting scan...`);

  let successCount = 0;
  for (const row of rs.rows) {
    const id = row.id;
    try {
      const res = await fetch('http://localhost:3000/api/puzzles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: id })
      });
      if (res.ok) {
        successCount++;
        if (successCount % 10 === 0) console.log(`Scanned ${successCount}/${rs.rows.length} games...`);
      } else {
        console.error(`Failed to scan game ${id}: Status ${res.status}`);
      }
    } catch (err) {
      console.error(`Error scanning game ${id}:`, err.message);
    }
  }
  
  console.log('Rescan complete!');
  process.exit(0);
}

run();
