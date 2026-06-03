import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../services/turso';

const BOOK_MOVES_QUERY = `
  SELECT
    bm.san,
    bm.uci,
    MAX(bm.is_mainline) AS is_mainline,
    COUNT(DISTINCT bm.line_id) AS line_count,
    GROUP_CONCAT(DISTINCT bl.name) AS line_names_raw,
    bl.color AS color
  FROM book_moves bm
  JOIN book_lines bl ON bm.line_id = bl.id
  WHERE bm.fen_before = ?
  GROUP BY bm.san
  ORDER BY MAX(bm.is_mainline) DESC, COUNT(DISTINCT bm.line_id) DESC
`;

function normalizeFen(fen: string): string {
  const parts = fen.split(' ');
  return `${parts[0]} ${parts[1]} ${parts[2]} -`;
}

function mapRowToMove(r: any) {
  return {
    san: r.san,
    uci: r.uci,
    isMainline: !!r.is_mainline,
    lineCount: Number(r.line_count),
    lineNames: r.line_names_raw ? String(r.line_names_raw).split(',').slice(0, 5) : [],
    color: r.color,
  };
}

function queryBookMoves(fen: string) {
  return turso.execute({
    sql: BOOK_MOVES_QUERY,
    args: [normalizeFen(fen)],
  });
}

export async function GET(req: NextRequest) {
  const fen = req.nextUrl.searchParams.get('fen');
  if (!fen) return NextResponse.json({ error: 'fen required' }, { status: 400 });
  try {
    const rs = await queryBookMoves(fen);
    return NextResponse.json({ fen: normalizeFen(fen), moves: rs.rows.map(mapRowToMove) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
