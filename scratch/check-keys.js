const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

// Manually parse .env
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

async function main() {
  try {
    const movesRs = await client.execute({
      sql: 'SELECT bm.id, bm.line_id, bm.ply, bm.fen_before, bm.fen_after, bm.san, bm.uci, bm.nag, bm.is_mainline, pc.comment, pc.arrows FROM book_moves bm LEFT JOIN position_comments pc ON bm.fen_after = pc.fen LIMIT 10',
    });
    
    console.log("Row count:", movesRs.rows.length);
    if (movesRs.rows.length > 0) {
      console.log("Keys in first row:", Object.keys(movesRs.rows[0]));
      console.log("First row data:", movesRs.rows[0]);
    }
    
    // Find one with non-null arrows to check
    const withArrows = movesRs.rows.filter(r => r.arrows !== null);
    console.log("Rows with arrows count in this sample:", withArrows.length);
    
  } catch (err) {
    console.error("Error fetching keys:", err);
  } finally {
    client.close();
  }
}

main();
