import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import { turso } from '../../services/turso';

interface GameMeta {
  white: string;
  black: string;
  result: string;
  date: string;
}

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function normalizeFen(fen: string): string {
  return fen.split(' ').slice(0, 4).join(' ');
}

function normalizeBookFen(fen: string): string {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

function getWinProbability(cp: number): number {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

function getSan(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m ? m.san : uci;
  } catch {
    return uci;
  }
}

async function fetchRandomPuzzle() {
  const sql = 'SELECT * FROM puzzles ORDER BY RANDOM() LIMIT 1';
  const rs = await turso.execute(sql);
  return rs.rows[0] || null;
}

async function fetchPuzzleById(id: string) {
  const sql = 'SELECT * FROM puzzles WHERE id = ?';
  const rs = await turso.execute({ sql, args: [id] });
  return rs.rows[0] || null;
}

async function fetchEvaluationForFen(fen: string) {
  const norm = fen.split(' ').slice(0, 4).join(' ');
  const sql = `SELECT result_json FROM analysis WHERE engine='sf18' AND limit_type='depth' AND multipv=4 AND fen_norm = ?`;
  const rs = await turso.execute({ sql, args: [norm] });
  return rs.rows[0] ? JSON.parse(rs.rows[0].result_json as string) : null;
}

function getGameFensUpTo(pgn: string, targetFen: string): string[] {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const fens = [chess.header().FEN || chess.header().Fen || STARTING_FEN];
  const temp = new Chess(fens[0]);
  for (const m of chess.history({ verbose: true })) {
    if (normalizeBookFen(temp.fen()) === normalizeBookFen(targetFen)) break;
    temp.move(m.san);
    fens.push(temp.fen());
  }
  return fens.map(normalizeBookFen).reverse();
}

async function queryBookLinesForFens(fens: string[]): Promise<Record<string, string>> {
  const placeholders = fens.map(() => '?').join(',');
  const sql = `SELECT bm.fen_before, bl.name FROM book_moves bm JOIN book_lines bl ON bm.line_id = bl.id WHERE bm.fen_before IN (${placeholders})`;
  const rs = await turso.execute({ sql, args: fens });
  const map: Record<string, string> = {};
  rs.rows.forEach(r => { map[String(r.fen_before)] = String(r.name); });
  return map;
}

async function fetchBookLineForGame(gameId: number, targetFen: string): Promise<string | null> {
  const game = await fetchGameForScan(gameId);
  if (!game) return null;
  const fens = getGameFensUpTo(game.pgn as string, targetFen);
  if (fens.length === 0) return null;
  const map = await queryBookLinesForFens(fens);
  const match = fens.find(f => map[f]);
  return match ? map[match] : null;
}

async function loadPuzzleDetails(puzzle: any) {
  const evalPromise = fetchEvaluationForFen(String(puzzle.start_fen));
  const bookPromise = fetchBookLineForGame(Number(puzzle.game_id), String(puzzle.start_fen));
  const [evaluation, bookLine] = await Promise.all([evalPromise, bookPromise]);
  return { evaluation, bookLine };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  try {
    const puzzle = id ? await fetchPuzzleById(id) : await fetchRandomPuzzle();
    if (!puzzle) return NextResponse.json({ error: 'No puzzles found' }, { status: 404 });
    const details = await loadPuzzleDetails(puzzle);
    return NextResponse.json({ puzzle, ...details });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

async function fetchGameForScan(gameId: number) {
  const sql = 'SELECT id, pgn, white_name, black_name, result, user_color, played_date FROM games WHERE id = ?';
  const rs = await turso.execute({ sql, args: [gameId] });
  return rs.rows[0] || null;
}

async function fetchCachedEvalsForFens(normFens: string[]) {
  const placeholders = normFens.map(() => '?').join(',');
  const sql = `SELECT fen_norm, result_json FROM analysis WHERE engine='sf18' AND limit_type='depth' AND multipv=4 AND fen_norm IN (${placeholders})`;
  const rs = await turso.execute({ sql, args: normFens });
  const map: Record<string, any> = {};
  rs.rows.forEach(r => { map[String(r.fen_norm)] = JSON.parse(r.result_json as string); });
  return map;
}

function getGameFensAndHistory(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const history = chess.history({ verbose: true });
  const fens = [chess.header().FEN || chess.header().Fen || STARTING_FEN];
  const temp = new Chess(fens[0]);
  for (const m of history) {
    temp.move(m.san);
    fens.push(temp.fen());
  }
  return { history, fens };
}

function detectBlunderDetails(evalBefore: any, evalAfter: any, isWhiteToMove: boolean) {
  const scoreBefore = isWhiteToMove ? evalBefore.cp : -evalBefore.cp;
  const scoreAfter = isWhiteToMove ? evalAfter.cp : -evalAfter.cp;
  if (scoreBefore === undefined || scoreAfter === undefined) return null;
  const wpBefore = getWinProbability(scoreBefore);
  const wpAfter = getWinProbability(-scoreAfter);
  return wpBefore - wpAfter >= 0.20 ? { scoreBefore, scoreAfter } : null;
}

function buildPuzzleRow(game: any, p: any, history: any[], fens: string[], i: number, uUserColor: string, isWhite: boolean) {
  const blunderUci = history[i].from + history[i].to + (history[i].promotion || '');
  const blunderSan = history[i].san;
  const gameTitle = `${game.white_name} vs ${game.black_name} (${game.played_date})`;
  const moveColor = isWhite ? 'w' : 'b';
  const isOpponent = moveColor !== uUserColor;
  const startFen = isOpponent ? fens[i + 1] : fens[i];
  const bestUci = isOpponent ? p.evalAfter.bestMove : p.evalBefore.bestMove;
  if (!bestUci) return null;
  const desc = isOpponent ? `Opponent played ${blunderSan}. Find the winning response!` : `You played ${blunderSan} in the game. Find the correct move instead!`;
  return [game.id, startFen, bestUci, getSan(startFen, bestUci), uUserColor, desc, blunderUci, blunderSan, gameTitle];
}

async function insertPuzzle(args: any[]) {
  const sql = `INSERT OR IGNORE INTO puzzles (game_id, start_fen, solution_uci, solution_san, player_color, description, blunder_uci, blunder_san, game_title) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const rs = await turso.execute({ sql, args });
  return rs.rowsAffected > 0;
}

async function processMoveIndex(game: any, history: any[], fens: string[], normFens: string[], evalMap: any, i: number, uUserColor: string) {
  const eb = evalMap[normFens[i]], ea = evalMap[normFens[i + 1]];
  if (!eb || !ea) return false;
  const isWhite = normFens[i].split(' ')[1] === 'w';
  const p = detectBlunderDetails(eb, ea, isWhite);
  if (!p) return false;
  const row = buildPuzzleRow(game, { evalBefore: eb, evalAfter: ea }, history, fens, i, uUserColor, isWhite);
  return row ? await insertPuzzle(row) : false;
}

async function scanGame(gameId: number) {
  const game = await fetchGameForScan(gameId);
  if (!game) return 0;
  const { history, fens } = getGameFensAndHistory(game.pgn as string);
  const normFens = fens.map(normalizeFen), evalMap = await fetchCachedEvalsForFens(normFens);
  const black = String(game.black_name || '').toLowerCase();
  const uColor = (game.user_color as string) || (black.includes('demanzonderjas') ? 'b' : 'w');
  const results = await Promise.all(history.map((_, i) => processMoveIndex(game, history, fens, normFens, evalMap, i, uColor)));
  return results.filter(Boolean).length;
}

export async function POST(req: NextRequest) {
  const { gameId } = await req.json();
  if (!gameId) return NextResponse.json({ error: 'Missing gameId' }, { status: 400 });
  try {
    const count = await scanGame(Number(gameId));
    return NextResponse.json({ success: true, count });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
