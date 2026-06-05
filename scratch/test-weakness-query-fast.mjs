import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { Chess } from 'chess.js';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

function normalizeFen3(fen) {
  const parts = fen.split(' ');
  return `${parts[0]} ${parts[1]} ${parts[2]}`;
}

async function findGameForFen(targetFen3) {
  const gamesRs = await client.execute("SELECT id, pgn, white_name, black_name, result, user_color, played_date FROM games");
  console.log(`Searching through ${gamesRs.rows.length} games...`);
  
  for (const game of gamesRs.rows) {
    const chess = new Chess();
    try {
      chess.loadPgn(game.pgn.trim());
      const history = chess.history({ verbose: true });
      const startFen = chess.header().FEN || chess.header().Fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      
      const temp = new Chess(startFen);
      if (normalizeFen3(temp.fen()) === targetFen3) {
        return game;
      }
      for (const m of history) {
        temp.move(m.san);
        if (normalizeFen3(temp.fen()) === targetFen3) {
          return game;
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  }
  return null;
}

async function run() {
  console.time('find_game');
  const target = 'r1b1kbnr/pp3ppp/1qn1p3/2ppP3/3P4/2P2N2/PP3PPP/RNBQKB1R w KQkq';
  const game = await findGameForFen(target);
  console.timeEnd('find_game');
  if (game) {
    console.log("Found game:", game.id, game.white_name, "vs", game.black_name);
  } else {
    console.log("No game found matching FEN");
  }
}

run().catch(console.error);
