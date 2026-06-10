import { Chess } from 'chess.js';
import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

// 1. Test the parseGameDetails logic on different PGN move counts
function preprocessPgn(pgn) {
  return pgn.replace(/\r\n/g, '\n');
}

function parseGameDetails(pgn) {
  const chess = new Chess();
  chess.loadPgn(preprocessPgn(pgn).trim());
  return { moveCount: Math.ceil(chess.history().length / 2) };
}

console.log("=== Testing parseGameDetails ===");

const pgn1 = `[Event "Test"]
[Site "Local"]
[Date "2026.06.09"]
[White "WhitePlayer"]
[Black "BlackPlayer"]
[Result "*"]

1. e4 e5 *`;

const pgn2 = `[Event "Test"]
[Site "Local"]
[Date "2026.06.09"]
[White "WhitePlayer"]
[Black "BlackPlayer"]
[Result "*"]

1. e4 e5 2. Nf3 *`;

const pgn3 = `[Event "Test"]
[Site "Local"]
[Date "2026.06.09"]
[White "WhitePlayer"]
[Black "BlackPlayer"]
[Result "*"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 *`;

console.log("2 plies (1. e4 e5) -> Expected: 1 move, Got:", parseGameDetails(pgn1).moveCount);
console.log("3 plies (1. e4 e5 2. Nf3) -> Expected: 2 moves, Got:", parseGameDetails(pgn2).moveCount);
console.log("5 plies (1. e4 e5 2. Nf3 Nc6 3. Bb5) -> Expected: 3 moves, Got:", parseGameDetails(pgn3).moveCount);

// 2. Query DB to check some games
const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function checkDb() {
  console.log("\n=== Checking database values ===");
  const rs = await client.execute("SELECT id, white_name, black_name, move_count FROM games LIMIT 5");
  for (const r of rs.rows) {
    console.log(`ID: ${r.id} | ${r.white_name} vs ${r.black_name} | Move Count: ${r.move_count}`);
  }
}

checkDb().catch(console.error);
