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

async function queryBestLine(fen: string) {
  const sql = 'SELECT line_id, ply FROM book_moves WHERE fen_before = ? ORDER BY is_mainline DESC, line_id ASC LIMIT 1';
  return turso.execute({ sql, args: [normalizeFen(fen)] });
}

async function getContinuation(lineId: number, ply: number): Promise<string[]> {
  const sql = 'SELECT uci FROM book_moves WHERE line_id = ? AND ply >= ? ORDER BY ply ASC LIMIT 14';
  const rs = await turso.execute({ sql, args: [lineId, ply] });
  return rs.rows.map((r) => String(r.uci));
}

async function getBookLineContinuation(fen: string): Promise<string[]> {
  const best = await queryBestLine(fen);
  if (best.rows.length === 0) return [];
  return getContinuation(Number(best.rows[0].line_id), Number(best.rows[0].ply));
}

export async function GET(req: NextRequest) {
  const fen = req.nextUrl.searchParams.get('fen');
  if (!fen) return NextResponse.json({ error: 'fen' }, { status: 400 });
  const rs = await queryBookMoves(fen).catch(() => null);
  if (!rs) return NextResponse.json({ error: 'DB error' }, { status: 500 });
  const pv = await getBookLineContinuation(fen);
  return NextResponse.json({ fen: normalizeFen(fen), moves: rs.rows.map(mapRowToMove), pv });
}
