const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || '';
const authToken = process.env.TURSO_AUTH_TOKEN || '';

const turso = createClient({
  url,
  authToken,
});

function normalizeBookFen(fen) {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

async function main() {
  try {
    const candidateFen = '1Bbq1rk1/1p2b2p/2p5/3r1p2/3Pn1p1/pP4P1/P2NPPBP/R2Q1RK1 b - -';
    const lineId = 1503;

    const movesRs = await turso.execute({
      sql: 'SELECT ply, san, uci, fen_after, fen_before FROM book_moves WHERE line_id = ? ORDER BY ply ASC',
      args: [lineId]
    });
    
    const moves = movesRs.rows.map(r => ({
      ply: Number(r.ply),
      san: String(r.san),
      uci: String(r.uci),
      fen_after: String(r.fen_after),
      fen_before: String(r.fen_before),
    }));

    console.log("Candidate FEN (normalized):", normalizeBookFen(candidateFen));

    const startIdx = moves.findIndex(
      m => {
        const normBefore = normalizeBookFen(m.fen_before);
        const normCandidate = normalizeBookFen(candidateFen);
        const matches = normBefore === normCandidate;
        console.log(`Ply ${m.ply}: before=${m.fen_before} (norm=${normBefore}) matches=${matches}`);
        return matches;
      }
    );

    console.log("startIdx:", startIdx);
  } catch (err) {
    console.error(err);
  }
}

main();
