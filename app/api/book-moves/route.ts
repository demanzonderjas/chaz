import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'node:path';

// Normalize FEN to match DB format:
// DB stores: "position color castling -" (no en passant, no move counters)
function normalizeFen(fen: string): string {
  const parts = fen.split(' ');
  return `${parts[0]} ${parts[1]} ${parts[2]} -`;
}

export async function GET(req: NextRequest) {
  const fen = req.nextUrl.searchParams.get('fen');
  if (!fen) return NextResponse.json({ error: 'fen required' }, { status: 400 });

  const normalized = normalizeFen(fen);
  const dbPath = path.join(process.cwd(), 'chess-coach.db');

  try {
    const db = new Database(dbPath, { readonly: true });

    const rows = db.prepare(`
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
    `).all(normalized);

    db.close();

    const moves = rows.map((r: any) => ({
      san: r.san,
      uci: r.uci,
      isMainline: !!r.is_mainline,
      lineCount: r.line_count,
      lineNames: r.line_names_raw ? r.line_names_raw.split(',').slice(0, 5) : [],
      color: r.color,
    }));

    return NextResponse.json({ fen: normalized, moves });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
