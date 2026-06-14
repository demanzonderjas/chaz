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
    // 1. Count existing comments in book_moves
    const countRs = await client.execute("SELECT COUNT(*) as cnt FROM book_moves WHERE comment IS NOT NULL AND comment != ''");
    const count = Number(countRs.rows[0].cnt);
    console.log(`Found ${count} rows with comments in book_moves.`);

    // 2. Create the position_comments table
    console.log("Creating table position_comments if it does not exist...");
    await client.execute(`
      CREATE TABLE IF NOT EXISTS position_comments (
        fen TEXT PRIMARY KEY,
        comment TEXT NOT NULL
      )
    `);
    console.log("Table position_comments created/verified successfully.");

    // 3. Migrate comments from book_moves
    if (count > 0) {
      console.log("Migrating existing comments...");
      const commentsRs = await client.execute("SELECT fen_after, comment FROM book_moves WHERE comment IS NOT NULL AND comment != ''");
      
      let migrated = 0;
      for (const row of commentsRs.rows) {
        const fen = String(row.fen_after);
        const comment = String(row.comment);
        
        await client.execute({
          sql: "INSERT INTO position_comments (fen, comment) VALUES (?, ?) ON CONFLICT(fen) DO UPDATE SET comment = excluded.comment",
          args: [fen, comment]
        });
        migrated++;
      }
      console.log(`Migrated ${migrated} comments to position_comments.`);
    }

  } catch (err) {
    console.error("Migration error:", err);
  } finally {
    client.close();
  }
}

main();
