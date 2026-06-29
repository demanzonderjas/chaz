const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || '';
const authToken = process.env.TURSO_AUTH_TOKEN || '';

const turso = createClient({
  url,
  authToken,
});

function normalizeBookFen(fen) {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} ${p[3]}`;
}

async function fetchBookCandidates(lineIds, color) {
  let sql = `
    SELECT DISTINCT bm.fen_before, bm.line_id 
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
  `;
  const args = [];
  if (lineIds?.length) {
    sql += ` AND bm.line_id IN (${lineIds.map(() => '?').join(',')})`;
    args.push(...lineIds);
  }
  if (color) {
    sql += ` AND SUBSTR(bm.fen_before, INSTR(bm.fen_before, ' ') + 1, 1) = ?`;
    args.push(color);
  }
  const rs = await turso.execute({ sql, args });
  return rs.rows.map(r => ({ fen: String(r.fen_before), line_id: Number(r.line_id) }));
}

async function fetchSolvedFens() {
  const rs = await turso.execute("SELECT start_fen FROM puzzle_stats WHERE last_result = 'success'");
  return new Set(rs.rows.map(r => normalizeBookFen(String(r.start_fen))));
}

async function fetchLineDetails(lineId) {
  const lineRs = await turso.execute({ sql: 'SELECT name, color FROM book_lines WHERE id = ?', args: [lineId] });
  return {
    name: lineRs.rows[0] ? String(lineRs.rows[0].name) : 'Book Line',
    color: lineRs.rows[0] ? String(lineRs.rows[0].color || '') : ''
  };
}

async function fetchBookPuzzle(openingId, color, days, isRetry = false) {
  const candidates = await fetchBookCandidates(openingId ? [openingId] : undefined, color);
  if (candidates.length === 0) return null;
  const solved = await fetchSolvedFens();
  const active = candidates.filter(c => !solved.has(normalizeBookFen(c.fen)));
  if (active.length === 0) return null;
  
  // Pick 50 random samples
  const colors = { w: 0, b: 0 };
  for (let i = 0; i < 100; i++) {
    const selected = active[Math.floor(Math.random() * active.length)];
    const { color: lineColor } = await fetchLineDetails(selected.line_id);
    const pColor = lineColor || selected.fen.split(' ')[1] || 'w';
    colors[pColor]++;
  }
  console.log("Distribution after 100 samples:", colors);
}

async function main() {
  await fetchBookPuzzle();
}

main();
