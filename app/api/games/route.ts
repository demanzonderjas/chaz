import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import { createHash } from 'crypto';
import { turso } from '../../services/turso';

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

async function fetchGamesList() {
  const sql = 'SELECT id, white_name, black_name, result, played_date, user_color, move_count FROM games ORDER BY played_date DESC, id DESC';
  const rs = await turso.execute(sql);
  return rs.rows;
}

async function handleGetRequest(id: string | null) {
  if (id) return { pgn: await fetchGamePgn(id) };
  return { games: await fetchGamesList() };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  try {
    const data = await handleGetRequest(id);
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
  const userColor = black.toLowerCase().includes('demanzonderjas') ? 'b' : 'w';
  return { white, black, result, playedDate, userColor };
}

function parseGameDetails(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const details = parseHeaders(chess.header());
  return { ...details, moveCount: chess.history().length };
}

async function insertGame(pgn: string, hash: string, d: any) {
  const sql = `
    INSERT INTO games (pgn, pgn_hash, move_count, white_name, black_name, result, played_date, user_color, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', datetime('now'))
  `;
  const args = [pgn, hash, d.moveCount, d.white, d.black, d.result, d.playedDate, d.userColor];
  await turso.execute({ sql, args });
}

function getMoveOutcome(result: string, userColor: string) {
  if (result === '1/2-1/2') return 'draw';
  if ((result === '1-0' && userColor === 'w') || (result === '0-1' && userColor === 'b')) return 'win';
  return 'loss';
}

async function upsertMoveStat(fen: string, uci: string, san: string, outcome: string) {
  const sql = `INSERT INTO position_moves (fen_norm, uci, san, wins, draws, losses) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(fen_norm, uci) DO UPDATE SET wins=wins+excluded.wins, draws=draws+excluded.draws, losses=losses+excluded.losses`;
  const w = outcome === 'win' ? 1 : 0, d = outcome === 'draw' ? 1 : 0, l = outcome === 'loss' ? 1 : 0;
  await turso.execute({ sql, args: [fen, uci, san, w, d, l] });
}

async function processMove(m: any, tempChess: Chess, outcome: string) {
  const parts = tempChess.fen().split(' ');
  const fenNorm = `${parts[0]} ${parts[1]} ${parts[2]}`;
  const uci = m.from + m.to + (m.promotion || '');
  await upsertMoveStat(fenNorm, uci, m.san, outcome);
  tempChess.move(m.san);
}

async function indexGameMoves(pgn: string, result: string, userColor: string) {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const history = chess.history({ verbose: true });
  const startFen = chess.header().FEN || chess.header().Fen;
  const tempChess = startFen ? new Chess(startFen) : new Chess();
  const outcome = getMoveOutcome(result, userColor);
  for (const m of history) {
    await processMove(m, tempChess, outcome);
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
  await insertGame(pgn, hash, d);
  await indexGameMoves(pgn, d.result, d.userColor);
  const newId = await fetchGameIdByHash(hash);
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
