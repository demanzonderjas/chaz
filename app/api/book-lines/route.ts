import { NextRequest, NextResponse } from 'next/server';
import { turso } from '../../services/turso';

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');

  if (id) {
    // Get single book line details
    try {
      const lineId = Number(id);
      const lineRs = await turso.execute({
        sql: 'SELECT id, name, color, notes FROM book_lines WHERE id = ?',
        args: [lineId]
      });
      if (lineRs.rows.length === 0) {
        return NextResponse.json({ error: 'Book line not found' }, { status: 404 });
      }

      const movesRs = await turso.execute({
        sql: 'SELECT bm.id, bm.line_id, bm.ply, bm.fen_before, bm.fen_after, bm.san, bm.uci, bm.nag, bm.is_mainline, pc.comment, pc.arrows FROM book_moves bm LEFT JOIN position_comments pc ON bm.fen_after = pc.fen WHERE bm.line_id = ? ORDER BY bm.ply ASC',
        args: [lineId]
      });

      const line = lineRs.rows[0];
      const moves = movesRs.rows.map(r => ({
        id: Number(r.id),
        line_id: Number(r.line_id),
        ply: Number(r.ply),
        fen_before: String(r.fen_before),
        fen_after: String(r.fen_after),
        san: String(r.san),
        uci: String(r.uci),
        comment: r.comment ? String(r.comment) : null,
        arrows: r.arrows ? String(r.arrows) : null,
        nag: r.nag ? String(r.nag) : null,
        is_mainline: Number(r.is_mainline)
      }));

      return NextResponse.json({
        line: {
          id: Number(line.id),
          name: String(line.name),
          color: String(line.color || ''),
          notes: line.notes ? String(line.notes) : null
        },
        moves
      });
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 });
    }
  }

  // Get all book lines grouped by opening
  try {
    const opsRs = await turso.execute('SELECT id, name, moves_uci FROM openings ORDER BY name ASC');
    const linesRs = await turso.execute('SELECT id, name, color, notes FROM book_lines ORDER BY name ASC');
    const movesRs = await turso.execute('SELECT line_id, ply, uci FROM book_moves WHERE ply <= 8 ORDER BY line_id, ply ASC');

    const ops = opsRs.rows.map(r => ({
      id: Number(r.id),
      name: String(r.name),
      moves_uci: String(r.moves_uci || ''),
      lines: [] as any[]
    }));

    const lines = linesRs.rows.map(r => ({
      id: Number(r.id),
      name: String(r.name),
      color: String(r.color || ''),
      notes: r.notes ? String(r.notes) : null
    }));

    // Group moves by line_id
    const lineMoves = new Map<number, string[]>();
    for (const m of movesRs.rows) {
      const lid = Number(m.line_id);
      if (!lineMoves.has(lid)) {
        lineMoves.set(lid, []);
      }
      lineMoves.get(lid)!.push(String(m.uci));
    }

    const otherGroup = {
      id: null,
      name: 'Other Openings',
      moves_uci: '',
      lines: [] as any[]
    };

    for (const line of lines) {
      const ucis = lineMoves.get(line.id) || [];
      const moveStr = ucis.join(' ');

      let matchedOp: typeof ops[0] | null = null;
      for (const op of ops) {
        if (op.moves_uci && moveStr.startsWith(op.moves_uci)) {
          if (!matchedOp || op.moves_uci.length > matchedOp.moves_uci.length) {
            matchedOp = op;
          }
        }
      }

      if (matchedOp) {
        matchedOp.lines.push(line);
      } else {
        // Fallback to name search
        const lowerName = line.name.toLowerCase();
        let nameMatchOp: typeof ops[0] | null = null;
        for (const op of ops) {
          if (lowerName.includes(op.name.toLowerCase())) {
            nameMatchOp = op;
            break;
          }
        }
        if (nameMatchOp) {
          nameMatchOp.lines.push(line);
        } else {
          otherGroup.lines.push(line);
        }
      }
    }

    // Filter out openings that have no mapped book lines
    const result = ops.filter(op => op.lines.length > 0);
    if (otherGroup.lines.length > 0) {
      result.push(otherGroup as any);
    }

    return NextResponse.json({ openings: result });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const { lineId, ply, comment, arrows } = await req.json();
    if (lineId === undefined || ply === undefined) {
      return NextResponse.json({ error: 'Missing lineId or ply' }, { status: 400 });
    }

    // Fetch the fen_after of this specific move to sync by FEN
    const moveRs = await turso.execute({
      sql: 'SELECT fen_after FROM book_moves WHERE line_id = ? AND ply = ?',
      args: [lineId, ply]
    });

    if (moveRs.rows.length > 0) {
      const fenAfter = String(moveRs.rows[0].fen_after);
      const hasComment = comment && comment.trim() !== '';
      const hasArrows = arrows && Array.isArray(arrows) && arrows.length > 0;

      if (hasComment || hasArrows) {
        const arrowsStr = hasArrows ? JSON.stringify(arrows) : null;
        await turso.execute({
          sql: 'INSERT INTO position_comments (fen, comment, arrows) VALUES (?, ?, ?) ON CONFLICT(fen) DO UPDATE SET comment = excluded.comment, arrows = excluded.arrows',
          args: [fenAfter, hasComment ? comment : '', arrowsStr]
        });
      } else {
        await turso.execute({
          sql: 'DELETE FROM position_comments WHERE fen = ?',
          args: [fenAfter]
        });
      }
    } else {
      return NextResponse.json({ error: 'Move not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
