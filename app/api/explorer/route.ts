import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../services/turso';

function normalizeFen3(fen: string): string {
  const parts = fen.split(' ');
  return `${parts[0]} ${parts[1]} ${parts[2]}`;
}

async function queryPositionMoves(fen: string) {
  const sql = 'SELECT uci, san, wins, draws, losses FROM position_moves WHERE fen_norm = ? ORDER BY (wins + draws + losses) DESC';
  const rs = await turso.execute({ sql, args: [normalizeFen3(fen)] });
  return rs.rows;
}

export async function GET(req: NextRequest) {
  const fen = req.nextUrl.searchParams.get('fen');
  if (!fen) return NextResponse.json({ moves: [] });
  try {
    const rows = await queryPositionMoves(fen);
    return NextResponse.json({ moves: rows });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
