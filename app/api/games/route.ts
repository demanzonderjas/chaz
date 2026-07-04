import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import { createHash } from 'crypto';
import { turso } from '../../services/turso';
import { preprocessPgn, isUserBlack } from '../../services/pgn';


interface HistoryEntry {
  fen: string;
  san: string;
  to: string;
}

async function fetchGamePgn(id: string) {
  const sql = 'SELECT pgn FROM games WHERE id = ?';
  const rs = await turso.execute({ sql, args: [id] });
  return rs.rows[0]?.pgn || null;
}

async function fetchGamesList(openingId?: number, color?: string) {
  let sql = 'SELECT id, white_name, black_name, result, played_date, user_color, move_count, white_elo, black_elo FROM games WHERE 1=1';
  const args: any[] = [];
  if (openingId !== undefined) {
    sql += ' AND opening_id = ?';
    args.push(openingId);
  }
  if (color !== undefined) {
    sql += ' AND user_color = ?';
    args.push(color);
  }
  sql += ' ORDER BY played_date DESC, id DESC';
  const rs = await turso.execute({ sql, args });
  return rs.rows;
}

async function handleGetRequest(id: string | null, openingId?: number, color?: string) {
  if (id) {
    const pgn = await fetchGamePgn(id);
    const rs = await turso.execute({ sql: 'SELECT fen_before FROM brilliant_moves WHERE game_id = ?', args: [id] });
    const brilliantMoves = rs.rows.map(r => String(r.fen_before));
    return { pgn, brilliantMoves };
  }
  return { games: await fetchGamesList(openingId, color) };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const openingIdParam = req.nextUrl.searchParams.get('openingId');
  const colorParam = req.nextUrl.searchParams.get('color');

  const openingId = openingIdParam ? Number(openingIdParam) : undefined;
  const color = colorParam || undefined;

  try {
    const data = await handleGetRequest(id, openingId, color);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

function computePgnHash(pgn: string): string {
  return createHash('sha256').update(pgn.trim()).digest('hex');
}

async function checkGameExists(hash: string): Promise<boolean> {
  const sql = 'SELECT id FROM games WHERE pgn_hash = ? LIMIT 1';
  const rs = await turso.execute({ sql, args: [hash] });
  return rs.rows.length > 0;
}

function parseHeaders(headers: Record<string, string | null | undefined>) {
  const white = headers['White'] || 'Unknown';
  const black = headers['Black'] || 'Unknown';
  const result = headers['Result'] || '*';
  const playedDate = headers['Date'] || 'Unknown';
  const userColor = isUserBlack(black) ? 'b' : 'w';
  const whiteElo = headers['WhiteElo'] ? parseInt(headers['WhiteElo'], 10) : null;
  const blackElo = headers['BlackElo'] ? parseInt(headers['BlackElo'], 10) : null;
  return { white, black, result, playedDate, userColor, whiteElo, blackElo };
}

function parseGameDetails(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(preprocessPgn(pgn).trim());
  const details = parseHeaders(chess.header());
  return { ...details, moveCount: Math.ceil(chess.history().length / 2), chess };
}

async function findMatchedOpeningId(chess: Chess): Promise<number | null> {
  const rs = await turso.execute('SELECT id, moves_uci FROM openings');
  const openings = rs.rows.map(r => ({ id: Number(r.id), movesUci: String(r.moves_uci) }));
  openings.sort((a, b) => b.movesUci.length - a.movesUci.length);
  
  const history = chess.history({ verbose: true });
  const gameMovesUci = history.map(m => m.from + m.to + (m.promotion || '')).join(' ');
  
  for (const op of openings) {
    if (gameMovesUci.startsWith(op.movesUci)) {
      return op.id;
    }
  }
  return null;
}

async function insertGame(pgn: string, hash: string, d: any) {
  const sql = `
    INSERT INTO games (pgn, pgn_hash, move_count, white_name, black_name, result, played_date, user_color, source, created_at, white_elo, black_elo, opening_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', datetime('now'), ?, ?, ?)
  `;
  const args = [pgn, hash, d.moveCount, d.white, d.black, d.result, d.playedDate, d.userColor, d.whiteElo, d.blackElo, d.openingId];
  await turso.execute({ sql, args });
}

function getMoveOutcome(result: string, userColor: string) {
  if (result === '1/2-1/2') return 'draw';
  if ((result === '1-0' && userColor === 'w') || (result === '0-1' && userColor === 'b')) return 'win';
  return 'loss';
}

async function upsertMoveStat(fen: string, uci: string, san: string, outcome: string, gameId: number) {
  const sql = `INSERT INTO position_moves (fen_norm, uci, san, wins, draws, losses, game_id) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(fen_norm, uci) DO UPDATE SET wins=wins+excluded.wins, draws=draws+excluded.draws, losses=losses+excluded.losses, game_id=excluded.game_id`;
  const w = outcome === 'win' ? 1 : 0, d = outcome === 'draw' ? 1 : 0, l = outcome === 'loss' ? 1 : 0;
  await turso.execute({ sql, args: [fen, uci, san, w, d, l, gameId] });
}

async function processMove(m: any, tempChess: Chess, outcome: string, gameId: number) {
  const parts = tempChess.fen().split(' ');
  const fenNorm = `${parts[0]} ${parts[1]} ${parts[2]}`;
  const uci = m.from + m.to + (m.promotion || '');
  await upsertMoveStat(fenNorm, uci, m.san, outcome, gameId);
  tempChess.move(m.san);
}

async function indexGameMoves(gameId: number, pgn: string, result: string, userColor: string) {
  const chess = new Chess();
  chess.loadPgn(preprocessPgn(pgn).trim());
  const history = chess.history({ verbose: true });
  const startFen = chess.header().FEN || chess.header().Fen;
  const tempChess = startFen ? new Chess(startFen) : new Chess();
  const outcome = getMoveOutcome(result, userColor);
  for (const m of history) {
    await processMove(m, tempChess, outcome, gameId);
  }
}

async function fetchGameIdByHash(hash: string): Promise<number | null> {
  const sql = 'SELECT id FROM games WHERE pgn_hash = ? LIMIT 1';
  const rs = await turso.execute({ sql, args: [hash] });
  return (rs.rows[0]?.id as number) || null;
}

async function handleImport(pgn: string) {
  const hash = computePgnHash(pgn);
  const existingId = await fetchGameIdByHash(hash);
  if (existingId) return { success: true, duplicate: true, id: existingId };
  const d = parseGameDetails(pgn);
  const openingId = await findMatchedOpeningId(d.chess);
  await insertGame(pgn, hash, { ...d, openingId });
  const newId = await fetchGameIdByHash(hash);
  if (!newId) throw new Error('Failed to retrieve game ID after insert');
  await indexGameMoves(newId, pgn, d.result, d.userColor);
  return { success: true, duplicate: false, id: newId };
}

export async function POST(req: NextRequest) {
  try {
    const { pgn } = await req.json();
    const result = await handleImport(pgn);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function deleteGameFromDb(id: string) {
  await turso.execute({ sql: 'DELETE FROM games WHERE id = ?', args: [id] });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
  try {
    await deleteGameFromDb(id);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
