import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import { turso } from '../../services/turso';

type PositionInput = { fen: string; san: string };

function normalizeFen(fen: string): string {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

function getUciFromFenSan(fen: string, san: string): string {
  try {
    const chess = new Chess(fen);
    const m = chess.moves({ verbose: true }).find((x) => x.san === san);
    return m ? m.from + m.to + (m.promotion || '') : '';
  } catch {
    return '';
  }
}

function buildBatchStatements(positions: PositionInput[]) {
  const statements: any[] = [];
  positions.forEach((pos) => {
    const fen = normalizeFen(pos.fen), uci = getUciFromFenSan(pos.fen, pos.san);
    statements.push({ sql: 'SELECT 1 FROM book_moves WHERE fen_before = ? AND (san = ? OR uci = ?) LIMIT 1', args: [fen, pos.san, uci] });
    statements.push({ sql: 'SELECT 1 FROM book_moves WHERE fen_before = ? LIMIT 1', args: [fen] });
  });
  return statements;
}

export async function POST(req: NextRequest) {
  const { positions } = (await req.json()) as { positions: PositionInput[] };
  if (!positions?.length) return NextResponse.json({ bookIndices: [], optionIndices: [] });
  try {
    const res = await turso.batch(buildBatchStatements(positions), 'read');
    const bookIndices = res.map((r, i) => i % 2 === 0 && r.rows.length ? i / 2 : -1).filter((x) => x !== -1);
    const optionIndices = res.map((r, i) => i % 2 === 1 && r.rows.length ? (i - 1) / 2 : -1).filter((x) => x !== -1);
    return NextResponse.json({ bookIndices, optionIndices });
  } catch (err) { return NextResponse.json({ error: String(err) }, { status: 500 }); }
}
