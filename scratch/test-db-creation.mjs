import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { Chess } from 'chess.js';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

function normalizeBookFen(fen) {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} ${p[3]}`;
}

async function run() {
  console.log("Starting DB verification for custom book line creation...");
  const name = "Test Variation Ruy Lopez: Berlin";
  const color = "w";
  const initialFen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const moves = ["e4", "e5", "Nf3", "Nc6", "Bb5", "Nf6"];

  const chess = new Chess(initialFen);
  const movesToInsert = [];
  for (let i = 0; i < moves.length; i++) {
    const san = moves[i];
    const fenBefore = normalizeBookFen(chess.fen());
    let moveObj = chess.move(san);
    const fenAfter = normalizeBookFen(chess.fen());
    const uci = moveObj.from + moveObj.to + (moveObj.promotion || '');
    movesToInsert.push({
      ply: i + 1,
      fen_before: fenBefore,
      fen_after: fenAfter,
      san,
      uci
    });
  }

  const tx = await client.transaction("write");
  let lineId;
  try {
    const lineInsert = await tx.execute({
      sql: "INSERT INTO book_lines (name, color, created_at) VALUES (?, ?, datetime('now'))",
      args: [name, color]
    });
    lineId = Number(lineInsert.lastInsertRowid);
    console.log(`Inserted book line, ID: ${lineId}`);

    for (const m of movesToInsert) {
      await tx.execute({
        sql: "INSERT INTO book_moves (line_id, ply, fen_before, fen_after, san, uci, is_mainline) VALUES (?, ?, ?, ?, ?, ?, 1)",
        args: [lineId, m.ply, m.fen_before, m.fen_after, m.san, m.uci]
      });
    }
    console.log(`Inserted ${movesToInsert.length} moves for line ID ${lineId}.`);

    // Verify they are in the DB
    const lineRs = await tx.execute({
      sql: "SELECT * FROM book_lines WHERE id = ?",
      args: [lineId]
    });
    console.log("Verified line in DB:", lineRs.rows);

    const movesRs = await tx.execute({
      sql: "SELECT * FROM book_moves WHERE line_id = ? ORDER BY ply ASC",
      args: [lineId]
    });
    console.log(`Verified ${movesRs.rows.length} moves in DB:`);
    console.log(movesRs.rows.map(r => `${r.ply}: ${r.san} (${r.uci})`));

    // Rollback so we don't contaminate the real database with test data
    await tx.rollback();
    console.log("Transaction successfully rolled back! Database is clean.");
  } catch (err) {
    console.error("Test failed, rolling back...", err);
    try {
      await tx.rollback();
    } catch {}
  } finally {
    client.close();
  }
}

run();
