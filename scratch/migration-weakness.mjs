import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { Chess } from 'chess.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  console.log("Adding column 'game_id' to 'position_moves' table...");
  try {
    await client.execute("ALTER TABLE position_moves ADD COLUMN game_id INTEGER");
    console.log("Successfully added column 'game_id'.");
  } catch (err) {
    if (err.message.includes("duplicate column name") || err.message.includes("already exists") || err.message.includes("duplicate")) {
      console.log("Column 'game_id' already exists. Continuing.");
    } else {
      throw err;
    }
  }

  // 1. Fetch all games to build FEN -> Game ID mapping in memory
  console.log("Fetching all games from database...");
  const gamesRs = await client.execute("SELECT id, pgn FROM games");
  console.log(`Fetched ${gamesRs.rows.length} games. Processing FENs in memory...`);

  const map = new Map();
  for (const game of gamesRs.rows) {
    const gameId = Number(game.id);
    const pgn = String(game.pgn);
    const chess = new Chess();
    try {
      chess.loadPgn(pgn.trim());
      const history = chess.history({ verbose: true });
      const startFen = chess.header().FEN || chess.header().Fen || STARTING_FEN;
      const temp = new Chess(startFen);

      for (const m of history) {
        const parts = temp.fen().split(' ');
        const fenNorm = `${parts[0]} ${parts[1]} ${parts[2]}`;
        const uci = m.from + m.to + (m.promotion || '');
        
        map.set(`${fenNorm}:::${uci}`, gameId);
        temp.move(m.san);
      }
    } catch (e) {
      // ignore parsing errors
    }
  }
  console.log(`In-memory mapping built with ${map.size} unique position-move entries.`);

  // 2. Fetch only WEAK position_moves with NULL game_id (to minimize HTTP calls and DB size)
  console.log("Fetching weak position_moves that have no game_id...");
  const pmRs = await client.execute(`
    SELECT fen_norm, uci
    FROM position_moves
    WHERE game_id IS NULL AND (losses > wins OR losses >= 2)
  `);
  console.log(`Found ${pmRs.rows.length} weak rows to backfill.`);

  if (pmRs.rows.length === 0) {
    console.log("No weak rows need backfilling. Done!");
    return;
  }

  // 3. Prepare updates
  const updates = [];
  for (const row of pmRs.rows) {
    const key = `${row.fen_norm}:::${row.uci}`;
    const gameId = map.get(key);
    if (gameId !== undefined) {
      updates.push({
        sql: "UPDATE position_moves SET game_id = ? WHERE fen_norm = ? AND uci = ?",
        args: [gameId, row.fen_norm, row.uci]
      });
    }
  }

  console.log(`Prepared ${updates.length} update statements out of ${pmRs.rows.length} candidate rows.`);
  if (updates.length === 0) {
    console.log("No matching game IDs found for these weak moves. Done!");
    return;
  }

  const batchSize = 100;
  console.log(`Running updates in batches of ${batchSize}...`);
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    console.time(`Batch ${i/batchSize + 1}`);
    try {
      await client.batch(batch);
      console.timeEnd(`Batch ${i/batchSize + 1}`);
    } catch (err) {
      console.error(`Error in batch ${i/batchSize + 1}:`, err);
      // Try single updates as a fallback if the batch fails
      for (const query of batch) {
        try {
          await client.execute(query);
        } catch (singleErr) {
          console.error("Failed single query:", query, singleErr);
        }
      }
    }
    if (i % 1000 === 0 && i > 0) {
      console.log(`Processed ${i}/${updates.length} updates...`);
    }
  }

  console.log("Backfill completed successfully!");
}

run().catch(console.error);
