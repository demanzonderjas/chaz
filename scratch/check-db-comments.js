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
    const rs = await client.execute("SELECT * FROM position_comments");
    console.log("Position Comments:");
    for (const row of rs.rows) {
      console.log(`- FEN: ${row.fen}`);
      console.log(`  Comment: ${row.comment}`);
      console.log(`  Arrows: ${row.arrows}`);
    }
  } catch (err) {
    console.error("Error fetching comments:", err);
  } finally {
    client.close();
  }
}

main();
