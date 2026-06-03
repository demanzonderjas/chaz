import { NextRequest, NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import path from 'node:path';

// Strip en passant + move counters to match DB format
function normalizeFen(fen: string): string {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

type PositionInput = { fen: string; san: string }; // fen = position BEFORE the move

export async function POST(req: NextRequest) {
  const body = await req.json() as { positions: PositionInput[] };
  if (!body.positions?.length) return NextResponse.json({ bookIndices: [] });

  const dbPath = path.join(process.cwd(), 'chess-coach.db');

  try {
    const db = new Database(dbPath, { readonly: true });

    const bookIndices: number[] = [];

    for (let i = 0; i < body.positions.length; i++) {
      const { fen, san } = body.positions[i];
      const normalized = normalizeFen(fen);
      const row = db.prepare(
        'SELECT 1 FROM book_moves WHERE fen_before = ? AND san = ? LIMIT 1'
      ).get(normalized, san);
      if (row) bookIndices.push(i);
    }

    db.close();
    return NextResponse.json({ bookIndices });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
