const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

async function rescanGames() {
  console.log('Fetching all games...');
  const rs = await client.execute('SELECT id FROM games ORDER BY id DESC');
  const gameIds = rs.rows.map(r => r.id);
  console.log(`Found ${gameIds.length} games. Starting rescan for brilliant moves...`);
  
  let scanned = 0;
  for (const id of gameIds) {
    try {
      const res = await fetch('http://localhost:3000/api/puzzles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: id })
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);
      scanned++;
      if (scanned % 10 === 0) console.log(`Scanned ${scanned}/${gameIds.length} games...`);
    } catch (err) {
      console.error(`Failed to scan game ${id}:`, err.message);
    }
  }
  
  const bMoves = await client.execute('SELECT COUNT(*) as c FROM brilliant_moves');
  console.log(`Rescan complete. Found ${bMoves.rows[0].c} brilliant moves total!`);
}

rescanGames();
