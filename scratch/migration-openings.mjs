import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { Chess } from 'chess.js';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

// Define general openings and their moves
const DEFINED_OPENINGS = [
  { name: 'Sicilian Defence', moves: ['e2e4', 'c7c5'] },
  { name: 'French Defence', moves: ['e2e4', 'e7e6'] },
  { name: 'Caro-Kann Defence', moves: ['e2e4', 'c7c6'] },
  { name: 'Scandinavian Defence', moves: ['e2e4', 'd7d5'] },
  { name: 'Nimzowitsch Defence', moves: ['e2e4', 'b8c6'] },
  { name: 'Alekhine Defence', moves: ['e2e4', 'g8f6'] },
  { name: 'Pirc Defence', moves: ['e2e4', 'd7d6'] },
  { name: 'Modern Defence', moves: ['e2e4', 'g7g6'] },
  { name: 'Ruy Lopez', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1b5'] },
  { name: 'Italian Game', moves: ['e2e4', 'e7e5', 'g1f3', 'b8c6', 'f1c4'] },
  { name: 'London System', moves: ['d2d4', 'd7d5', 'g1f3', 'g8f6', 'c1f4'] },
  { name: 'Queen\'s Gambit', moves: ['d2d4', 'd7d5', 'c2c4'] },
  { name: 'King\'s Indian / Grunfeld', moves: ['d2d4', 'g8f6', 'c2c4', 'g7g6'] },
  { name: 'Indian Defences', moves: ['d2d4', 'g8f6', 'c2c4', 'e7e6'] },
  { name: 'Dutch Defence', moves: ['d2d4', 'f7f5'] },
  { name: 'English Opening', moves: ['c2c4'] },
  { name: 'Reti / KIA', moves: ['g1f3'] }
];

// Helper to compute target FEN for an opening
function getOpeningDetails(moves) {
  const chess = new Chess();
  for (const m of moves) {
    chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
  }
  return {
    target_fen: chess.fen(),
    moves_uci: moves.join(' '),
    move_count: moves.length
  };
}

async function run() {
  console.log("Re-initializing openings table...");
  
  // Clear openings table
  await client.execute("DELETE FROM openings");
  
  // Insert defined openings
  const dbOpenings = [];
  for (const op of DEFINED_OPENINGS) {
    const details = getOpeningDetails(op.moves);
    await client.execute({
      sql: `INSERT OR IGNORE INTO openings (name, moves_uci, target_fen, move_count, created_at)
            VALUES (?, ?, ?, ?, datetime('now'))`,
      args: [op.name, details.moves_uci, details.target_fen, details.move_count]
    });
    
    // Fetch inserted row to get its ID
    const rs = await client.execute({
      sql: "SELECT id, name, moves_uci FROM openings WHERE name = ?",
      args: [op.name]
    });
    dbOpenings.push(rs.rows[0]);
  }
  console.log(`Inserted ${dbOpenings.length} openings into database.`);

  // Fetch all games
  console.log("Fetching all games from database to classify...");
  const gamesRs = await client.execute("SELECT id, pgn FROM games");
  console.log(`Fetched ${gamesRs.rows.length} games. Matching in memory...`);

  let matchedCount = 0;
  const updates = [];

  for (const game of gamesRs.rows) {
    const gameId = Number(game.id);
    const pgn = String(game.pgn);
    const chess = new Chess();
    
    try {
      chess.loadPgn(pgn.trim());
      const history = chess.history({ verbose: true });
      const gameMovesUci = history.map(m => m.from + m.to + (m.promotion || '')).join(' ');
      
      // Match against openings (sort by move_count descending to match longest pattern first)
      const sortedDbOpenings = [...dbOpenings].sort((a, b) => b.moves_uci.length - a.moves_uci.length);
      let matchedOpeningId = null;
      
      for (const op of sortedDbOpenings) {
        if (gameMovesUci.startsWith(op.moves_uci)) {
          matchedOpeningId = Number(op.id);
          break;
        }
      }
      
      updates.push({
        sql: "UPDATE games SET opening_id = ? WHERE id = ?",
        args: [matchedOpeningId, gameId]
      });
      if (matchedOpeningId !== null) matchedCount++;
    } catch (e) {
      // ignore parse errors
    }
  }

  console.log(`Matched ${matchedCount}/${gamesRs.rows.length} games to defined openings.`);
  console.log("Applying updates in batches of 100...");
  
  const batchSize = 100;
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await client.batch(batch);
  }

  console.log("Opening classification migration completed successfully!");
}

run().catch(console.error);
