import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../services/turso';

type PositionInput = { fen: string; san: string };

function normalizeFen(fen: string): string {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

function buildBatchStatements(positions: PositionInput[]) {
  return positions.map((pos) => ({
    sql: 'SELECT 1 FROM book_moves WHERE fen_before = ? AND san = ? LIMIT 1',
    args: [normalizeFen(pos.fen), pos.san],
  }));
}

function getBookIndices(results: any[]): number[] {
  return results.map((r, i) => (r.rows.length ? i : -1)).filter((x) => x !== -1);
}

export async function POST(req: NextRequest) {
  const { positions } = (await req.json()) as { positions: PositionInput[] };
  if (!positions?.length) return NextResponse.json({ bookIndices: [] });
  try {
    const res = await turso.batch(buildBatchStatements(positions), 'read');
    return NextResponse.json({ bookIndices: getBookIndices(res) });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
