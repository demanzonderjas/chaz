import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../../services/turso';

export async function POST(req: NextRequest) {
  try {
    const { puzzleId, startFen, success } = await req.json();
    if (!startFen) {
      return NextResponse.json({ error: 'Missing startFen' }, { status: 400 });
    }

    if (success) {
      const sql = `
        INSERT INTO puzzle_stats (start_fen, puzzle_id, mistakes, last_result, updated_at)
        VALUES (?, ?, 0, 'success', CURRENT_TIMESTAMP)
        ON CONFLICT(start_fen) DO UPDATE SET
          mistakes = 0,
          last_result = 'success',
          updated_at = CURRENT_TIMESTAMP
      `;
      await turso.execute({ sql, args: [startFen, puzzleId || null] });
    } else {
      const sql = `
        INSERT INTO puzzle_stats (start_fen, puzzle_id, mistakes, last_result, updated_at)
        VALUES (?, ?, 1, 'fail', CURRENT_TIMESTAMP)
        ON CONFLICT(start_fen) DO UPDATE SET
          mistakes = mistakes + 1,
          last_result = 'fail',
          updated_at = CURRENT_TIMESTAMP
      `;
      await turso.execute({ sql, args: [startFen, puzzleId || null] });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
