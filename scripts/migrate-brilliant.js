const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

async function run() {
  try {
    await client.execute(`
      CREATE TABLE IF NOT EXISTS brilliant_moves (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        fen_before TEXT NOT NULL,
        fen_after TEXT NOT NULL,
        played_uci TEXT NOT NULL,
        played_san TEXT NOT NULL,
        player_color TEXT NOT NULL,
        game_title TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('Successfully created brilliant_moves table.');
  } catch (err) {
    console.error('Error creating table:', err);
  }
}

run();
