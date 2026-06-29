const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || '';
const authToken = process.env.TURSO_AUTH_TOKEN || '';

const turso = createClient({
  url,
  authToken,
});

async function main() {
  try {
    const rs = await turso.execute(`
      SELECT 
        bl.color as line_color,
        SUBSTR(bm.fen_before, INSTR(bm.fen_before, ' ') + 1, 1) as turn,
        COUNT(*) as count
      FROM book_moves bm
      JOIN book_lines bl ON bm.line_id = bl.id
      LEFT JOIN book_moves prev ON bm.line_id = prev.line_id AND prev.ply = bm.ply - 1
      WHERE (bl.color IS NULL OR bl.color = '' OR SUBSTR(bm.fen_before, INSTR(bm.fen_before, ' ') + 1, 1) = bl.color)
        AND NOT (
          prev.id IS NOT NULL
          AND bm.san LIKE '%x%' 
          AND prev.san LIKE '%x%' 
          AND SUBSTR(bm.uci, 3, 2) = SUBSTR(prev.uci, 3, 2)
        )
      GROUP BY line_color, turn
    `);
    console.log("Candidate counts by color/turn:", rs.rows);
  } catch (err) {
    console.error(err);
  }
}

main();
