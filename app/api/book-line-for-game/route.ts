import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import { turso } from '../../services/turso';
import { preprocessPgn } from '../../services/pgn';


const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function normalizeBookFen(fen: string): string {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

export async function GET(req: NextRequest) {
  const gameId = req.nextUrl.searchParams.get('gameId');
  if (!gameId) return NextResponse.json({ error: 'gameId required' }, { status: 400 });

  try {
    const gameRs = await turso.execute({
      sql: 'SELECT pgn FROM games WHERE id = ?',
      args: [gameId]
    });
    if (gameRs.rows.length === 0) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
    const pgn = String(gameRs.rows[0].pgn);

    const chess = new Chess();
    chess.loadPgn(preprocessPgn(pgn).trim());
    const history = chess.history({ verbose: true });
    
    const fens = [chess.header().FEN || chess.header().Fen || STARTING_FEN];
    const temp = new Chess(fens[0]);
    for (const m of history) {
      temp.move(m.san);
      fens.push(temp.fen());
    }

    const normFens = fens.map(normalizeBookFen);
    
    const placeholders = normFens.map(() => '?').join(',');
    const sql = `
      SELECT DISTINCT bm.line_id, bm.fen_before, bl.name
      FROM book_moves bm
      JOIN book_lines bl ON bm.line_id = bl.id
      WHERE bm.fen_before IN (${placeholders})
    `;
    const rs = await turso.execute({ sql, args: normFens });
    
    if (rs.rows.length === 0) {
      return NextResponse.json({ bookLine: null });
    }

    let deepestMatch: any = null;
    let deepestIndex = -1;
    
    rs.rows.forEach(row => {
      const idx = normFens.indexOf(String(row.fen_before));
      if (idx > deepestIndex) {
        deepestIndex = idx;
        deepestMatch = row;
      }
    });

    if (!deepestMatch) {
      return NextResponse.json({ bookLine: null });
    }

    const lineId = Number(deepestMatch.line_id);
    const lineName = String(deepestMatch.name);

    const movesRs = await turso.execute({
      sql: 'SELECT bm.ply, bm.san, bm.uci, bm.fen_after, pc.comment, pc.arrows FROM book_moves bm LEFT JOIN position_comments pc ON bm.fen_after = pc.fen WHERE bm.line_id = ? ORDER BY bm.ply ASC',
      args: [lineId]
    });

    const moves = movesRs.rows.map(r => ({
      ply: Number(r.ply),
      san: String(r.san),
      uci: String(r.uci),
      fen_after: String(r.fen_after),
      comment: r.comment ? String(r.comment) : null,
      arrows: r.arrows ? String(r.arrows) : null,
    }));

    return NextResponse.json({
      bookLine: {
        id: lineId,
        name: lineName,
        start_fen: STARTING_FEN,
        moves,
      }
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
