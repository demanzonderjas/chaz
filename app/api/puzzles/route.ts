import { NextRequest, NextResponse } from 'next/server';
import { Chess } from 'chess.js';
import { turso } from '../../services/turso';
import { preprocessPgn, isUserBlack } from '../../services/pgn';


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
  return `${p[0]} ${p[1]} ${p[2]} ${p[3]}`;
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

function getMaterialBalance(fen: string): number {
  const board = fen.split(' ')[0];
  const values: Record<string, number> = { p: -1, n: -3, b: -3, r: -5, q: -9, P: 1, N: 3, B: 3, R: 5, Q: 9 };
  return [...board].reduce((acc, char) => acc + (values[char] || 0), 0);
}

function isSacrifice(fenBefore: string, fenAfter: string, pvAfter: string[], playerColor: 'w' | 'b'): boolean {
  try {
    const startBal = getMaterialBalance(fenBefore) * (playerColor === 'w' ? 1 : -1);
    const chess = new Chess(fenAfter);
    
    const balAfterMove = getMaterialBalance(chess.fen()) * (playerColor === 'w' ? 1 : -1);
    if (balAfterMove <= startBal - 2) return true; 

    if (pvAfter && pvAfter.length > 0) {
      const m0 = pvAfter[0];
      const move0 = chess.move({ from: m0.slice(0, 2), to: m0.slice(2, 4), promotion: m0[4] });
      if (!move0) return false;
      const balAfterOpp = getMaterialBalance(chess.fen()) * (playerColor === 'w' ? 1 : -1);
      
      if (pvAfter.length > 1) {
        const m1 = pvAfter[1];
        const move1 = chess.move({ from: m1.slice(0, 2), to: m1.slice(2, 4), promotion: m1[4] });
        if (!move1) return balAfterOpp <= startBal - 2;
        const balAfterUs = getMaterialBalance(chess.fen()) * (playerColor === 'w' ? 1 : -1);
        return balAfterOpp <= startBal - 2 && balAfterUs <= startBal - 2;
      } else {
        return balAfterOpp <= startBal - 2;
      }
    }
    return false;
  } catch { 
    return false; 
  }
}

function getDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

function buildPuzzleSql(openingId?: number, color?: string, days?: number, onlyActive = true): { sql: string; args: any[] } {
  let sql = `SELECT p.*, COALESCE(s.mistakes, 0) as mistakes, s.last_result FROM puzzles p JOIN games g ON p.game_id = g.id LEFT JOIN puzzle_stats s ON p.start_fen = s.start_fen WHERE p.type = ? AND p.solution_uci != '(none)'`;
  const args: any[] = [];
  if (onlyActive) sql += ` AND (s.last_result IS NULL OR s.last_result = 'fail')`;
  if (openingId !== undefined) { sql += ` AND g.opening_id = ?`; args.push(openingId); }
  if (color !== undefined) { sql += ` AND g.user_color = ?`; args.push(color); }
  if (days !== undefined) { sql += ` AND g.played_date >= ?`; args.push(getDateDaysAgo(days)); }
  sql += ` ORDER BY g.played_date DESC, g.id DESC LIMIT 150`;
  return { sql, args };
}

function computeWeights(pool: any[]) {
  const N = pool.length;
  let total = 0;
  const items = pool.map((r, i) => {
    const w = (1 + Number(r.mistakes || 0) * 5) * (r.last_result === 'success' ? 0.02 : 1) * (N - i);
    total += w;
    return { r, w };
  });
  return { items, total };
}

function chooseItem(items: any[], total: number, fallback: any) {
  let rand = Math.random() * total;
  for (const x of items) {
    rand -= x.w;
    if (rand <= 0) return x.r;
  }
  return fallback;
}

function getRowFens(r: any) {
  try {
    const chess = new Chess(r.start_fen);
    chess.move({ from: r.blunder_uci.slice(0, 2), to: r.blunder_uci.slice(2, 4), promotion: r.blunder_uci[4] });
    return { normBefore: normalizeFen(r.start_fen), normAfter: normalizeFen(chess.fen()) };
  } catch {
    return null;
  }
}

function mapRowsToFens(rows: any[], fens: string[]) {
  return rows.map(r => {
    const res = getRowFens(r);
    if (!res) return null;
    fens.push(res.normBefore, res.normAfter);
    return { r, ...res };
  }).filter(Boolean) as any[];
}

function isDropSignificant(eb: any, ea: any): boolean {
  if (!eb || !ea) return true;
  const drop = getWinProbability(getSideToMoveScore(eb)) - getWinProbability(-getSideToMoveScore(ea));
  return drop >= 0.25;
}

async function filterMinorMistakes(rows: any[], type: string): Promise<any[]> {
  if (type === 'opening' || type === 'book' || type === 'weakness') return rows;
  const fens: string[] = [];
  const list = mapRowsToFens(rows, fens);
  if (fens.length === 0) return rows;
  const evalMap = await fetchCachedEvalsForFens(Array.from(new Set(fens)));
  return list.filter(item => isDropSignificant(evalMap[item.normBefore], evalMap[item.normAfter])).map(item => item.r);
}

async function clearPuzzleStatsByType(type: string) {
  const sql = `DELETE FROM puzzle_stats WHERE start_fen IN (SELECT start_fen FROM puzzles WHERE type = ?)`;
  await turso.execute({ sql, args: [type] });
}

async function clearStatsIfPuzzlesExist(type: string, openingId?: number, color?: string, days?: number) {
  const { sql, args } = buildPuzzleSql(openingId, color, days, false);
  const rs = await turso.execute({ sql, args: [type, ...args] });
  if (rs.rows.length > 0) await clearPuzzleStatsByType(type);
}

async function chooseFromRows(rows: any[], type: string) {
  if (rows.length === 0) return null;
  const filtered = await filterMinorMistakes(rows, type);
  const pool = filtered.length > 0 ? filtered : rows;
  const { items, total } = computeWeights(pool);
  return chooseItem(items, total, pool[0]);
}

async function fetchRandomPuzzle(type = 'tactical', openingId?: number, color?: string, days?: number) {
  let { sql, args } = buildPuzzleSql(openingId, color, days, true);
  let rs = await turso.execute({ sql, args: [type, ...args] });
  if (rs.rows.length === 0) {
    await clearStatsIfPuzzlesExist(type, openingId, color, days);
    ({ sql, args } = buildPuzzleSql(openingId, color, days, true));
    rs = await turso.execute({ sql, args: [type, ...args] });
  }
  return chooseFromRows(rs.rows, type);
}

async function fetchPuzzleById(id: string) {
  const sql = 'SELECT * FROM puzzles WHERE id = ?';
  const rs = await turso.execute({ sql, args: [id] });
  return rs.rows[0] || null;
}

async function fetchEvaluationForFen(fen: string) {
  const norm = fen.split(' ').slice(0, 4).join(' ');
  const sql = `
    SELECT multipv, limit_value, result_json 
    FROM analysis 
    WHERE engine = 'sf18' 
      AND limit_type = 'depth' 
      AND (multipv = 1 OR multipv = 4) 
      AND fen_norm = ?
  `;
  const rs = await turso.execute({ sql, args: [norm] });
  if (rs.rows.length === 0) return null;
  
  let bestRow = rs.rows[0];
  for (const row of rs.rows) {
    const bm = Number(bestRow.multipv);
    const rm = Number(row.multipv);
    if (rm > bm || (rm === bm && Number(row.limit_value) > Number(bestRow.limit_value))) {
      bestRow = row;
    }
  }
  return JSON.parse(bestRow.result_json as string);
}

function getGameFensUpTo(pgn: string, targetFen: string): string[] {
  const chess = new Chess();
  chess.loadPgn(preprocessPgn(pgn).trim());
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

async function fetchBookLineForGame(gameOrPgn: number | string, targetFen: string): Promise<string | null> {
  const pgn = typeof gameOrPgn === 'string' ? gameOrPgn : (await fetchGameForScan(gameOrPgn))?.pgn as string;
  const fens = pgn ? getGameFensUpTo(pgn, targetFen) : [];
  if (fens.length === 0) return null;
  const map = await queryBookLinesForFens(fens);
  const match = fens.find(f => map[f]);
  return match ? map[match] : null;
}

async function fetchBlunderEvaluation(startFen: string, blunderUci: string) {
  try {
    const chess = new Chess(startFen);
    chess.move({ from: blunderUci.slice(0, 2), to: blunderUci.slice(2, 4), promotion: blunderUci[4] });
    return await fetchEvaluationForFen(chess.fen());
  } catch {
    return null;
  }
}

async function loadPuzzleDetails(puzzle: any) {
  const evalPromise = fetchEvaluationForFen(String(puzzle.start_fen));
  const bookPromise = fetchBookLineForGame(Number(puzzle.game_id), String(puzzle.start_fen));
  const blunderEvalPromise = puzzle.blunder_uci ? fetchBlunderEvaluation(String(puzzle.start_fen), String(puzzle.blunder_uci)) : Promise.resolve(null);
  const [evaluation, bookLine, blunderEvaluation] = await Promise.all([evalPromise, bookPromise, blunderEvalPromise]);
  return { evaluation, bookLine, blunderEvaluation };
}

async function fetchBookLinesForFenWithLimit(fenBefore: string, candidateLineId: number, lineColor: string) {
  const bookFen = normalizeBookFen(fenBefore);
  const lineIdsRs = await turso.execute({
    sql: 'SELECT DISTINCT line_id FROM book_moves WHERE fen_before = ?',
    args: [bookFen]
  });
  
  if (lineIdsRs.rows.length === 0) return { bookLines: [], isSequence: false };
  
  const lineIds = lineIdsRs.rows.map(r => Number(r.line_id));
  const linesData: any[] = [];
  let isSequence = false;
  
  const checkLineId = lineIds.includes(candidateLineId) ? candidateLineId : lineIds[0];
  
  const checkMovesRs = await turso.execute({
    sql: 'SELECT ply, san, uci, fen_after, fen_before FROM book_moves WHERE line_id = ? ORDER BY ply ASC',
    args: [checkLineId]
  });
  const checkMoves = checkMovesRs.rows.map(r => ({
    ply: Number(r.ply),
    san: String(r.san),
    uci: String(r.uci),
    fen_after: String(r.fen_after),
    fen_before: String(r.fen_before),
  }));
  
  const startIdx = checkMoves.findIndex(m => normalizeBookFen(m.fen_before) === bookFen);
  if (startIdx !== -1) {
    const remainingMoves = checkMoves.slice(startIdx + 1);
    const playerColor = lineColor || fenBefore.split(' ')[1] || 'w';
    const hasMorePlayerMoves = remainingMoves.some(m => {
      const isMoveWhite = m.ply % 2 === 1;
      const isPlayerMove = (playerColor === 'w' && isMoveWhite) || (playerColor === 'b' && !isMoveWhite);
      return isPlayerMove;
    });
    if (hasMorePlayerMoves) {
      isSequence = Math.random() < 0.5;
    }
  }

  for (const lineId of lineIds.slice(0, 3)) {
    const nameRs = await turso.execute({
      sql: 'SELECT name, color FROM book_lines WHERE id = ?',
      args: [lineId]
    });
    const lineName = nameRs.rows[0] ? String(nameRs.rows[0].name) : `Line #${lineId}`;
    const lineCol = nameRs.rows[0] ? String(nameRs.rows[0].color || '') : '';
    
    const movesRs = await turso.execute({
      sql: 'SELECT ply, san, uci, fen_after, fen_before FROM book_moves WHERE line_id = ? ORDER BY ply ASC',
      args: [lineId]
    });
    
    let lineMoves = movesRs.rows.map(r => ({
      ply: Number(r.ply),
      san: String(r.san),
      uci: String(r.uci),
      fen_after: String(r.fen_after),
      fen_before: String(r.fen_before),
    }));
    
    const sIdx = lineMoves.findIndex(m => normalizeBookFen(m.fen_before) === bookFen);
    if (sIdx !== -1) {
      if (isSequence) {
        let N = Math.min(lineMoves.length - sIdx, 9);
        if (N % 2 === 0) {
          N = N - 1;
        }
        lineMoves = lineMoves.slice(0, sIdx + N);
      } else {
        lineMoves = lineMoves.slice(0, sIdx + 1);
      }
    }
    
    linesData.push({
      id: lineId,
      name: lineName,
      color: lineCol,
      start_fen: STARTING_FEN,
      moves: lineMoves,
    });
  }
  
  return { bookLines: linesData, isSequence };
}

async function getLineIdsForOpening(openingId: number): Promise<number[]> {
  const opRs = await turso.execute({ sql: 'SELECT moves_uci FROM openings WHERE id = ?', args: [openingId] });
  if (opRs.rows.length === 0 || !opRs.rows[0].moves_uci) return [];
  const prefix = String(opRs.rows[0].moves_uci);
  const movesRs = await turso.execute('SELECT line_id, uci FROM book_moves WHERE ply <= 8 ORDER BY line_id, ply ASC');
  return matchLinesToPrefix(movesRs.rows, prefix);
}

function matchLinesToPrefix(rows: any[], prefix: string): number[] {
  const lineMoves = new Map<number, string[]>();
  rows.forEach(m => {
    const lid = Number(m.line_id);
    if (!lineMoves.has(lid)) lineMoves.set(lid, []);
    lineMoves.get(lid)!.push(String(m.uci));
  });
  return Array.from(lineMoves.keys()).filter(lid => lineMoves.get(lid)!.join(' ').startsWith(prefix));
}

async function fetchBookCandidates(lineIds?: number[], color?: string) {
  let sql = `
    SELECT DISTINCT bm.fen_before, bm.line_id 
    FROM book_moves bm
    JOIN book_lines bl ON bm.line_id = bl.id
    LEFT JOIN book_moves prev ON bm.line_id = prev.line_id AND prev.ply = bm.ply - 1
    WHERE (bl.color IS NULL OR bl.color = '' OR SUBSTR(bm.fen_before, INSTR(bm.fen_before, ' ') + 1, 1) = bl.color)
      AND NOT (
        prev.id IS NOT NULL
        AND bm.san LIKE '%x%' 
        AND prev.san LIKE '%x%' 
        AND SUBSTR(bm.uci, 3, 2) = SUBSTR(prev.uci, 3, 2)
      )
  `;
  const args: any[] = [];
  if (lineIds?.length) {
    sql += ` AND bm.line_id IN (${lineIds.map(() => '?').join(',')})`;
    args.push(...lineIds);
  }
  if (color) {
    sql += ` AND SUBSTR(bm.fen_before, INSTR(bm.fen_before, ' ') + 1, 1) = ?`;
    args.push(color);
  }
  const rs = await turso.execute({ sql, args });
  return rs.rows.map(r => ({ fen: String(r.fen_before), line_id: Number(r.line_id) }));
}

async function fetchSolvedFens(): Promise<Set<string>> {
  const rs = await turso.execute("SELECT start_fen FROM puzzle_stats WHERE last_result = 'success'");
  return new Set(rs.rows.map(r => normalizeBookFen(String(r.start_fen))));
}

async function retryBookPuzzle(openingId?: number, color?: string, days?: number, isRetry = false) {
  if (isRetry) return null;
  await turso.execute("DELETE FROM puzzle_stats WHERE start_fen IN (SELECT DISTINCT fen_before FROM book_moves)");
  return fetchBookPuzzle(openingId, color, days, true);
}

function createBookPuzzleObj(sel: any, moves: any[], bmMain: any, lineName: string, lineColor: string, isSequence: boolean, bookLines: any[]) {
  const ucis = moves.map(r => String(r.uci)), sans = moves.map(r => String(r.san));
  return {
    id: -sel.line_id * 1000 - Math.floor(Math.random() * 1000), type: 'book', game_id: null,
    start_fen: sel.fen, solution_uci: String(bmMain.uci), solution_san: String(bmMain.san),
    player_color: lineColor || sel.fen.split(' ')[1] || 'w', 
    is_sequence: isSequence,
    description: isSequence 
      ? 'Find the correct sequence of book moves in this position!' 
      : 'Find the correct book move in this position!',
    blunder_uci: null, blunder_san: null, game_title: `Book practice: ${lineName}`,
    valid_moves: ucis, valid_moves_san: sans, game_pgn: null, book_lines: bookLines
  };
}

async function fetchLineDetails(lineId: number): Promise<{ name: string; color: string }> {
  const lineRs = await turso.execute({ sql: 'SELECT name, color FROM book_lines WHERE id = ?', args: [lineId] });
  return {
    name: lineRs.rows[0] ? String(lineRs.rows[0].name) : 'Book Line',
    color: lineRs.rows[0] ? String(lineRs.rows[0].color || '') : ''
  };
}

async function buildBookPuzzleFromCandidate(selected: { fen: string; line_id: number }) {
  const moves = (await turso.execute({ sql: 'SELECT uci, san, is_mainline, ply FROM book_moves WHERE fen_before = ?', args: [selected.fen] })).rows;
  if (moves.length === 0) return null;
  const bmMain = moves.find(r => Number(r.is_mainline) === 1) || moves[0];
  const { name: lineName, color: lineColor } = await fetchLineDetails(selected.line_id);
  const { bookLines, isSequence } = await fetchBookLinesForFenWithLimit(selected.fen, selected.line_id, lineColor);
  const puzzle = createBookPuzzleObj(selected, moves, bmMain, lineName, lineColor, isSequence, bookLines);
  const [evaluation, bookLine] = await Promise.all([fetchEvaluationForFen(selected.fen), fetchBookLineForGame('', selected.fen)]);
  return { puzzle, evaluation, bookLine };
}

async function fetchBookPuzzle(openingId?: number, color?: string, days?: number, isRetry = false): Promise<any> {
  const lineIds = openingId !== undefined ? await getLineIdsForOpening(openingId) : undefined;
  if (openingId !== undefined && lineIds?.length === 0) return null;

  // Determine target color to ensure even white/black distribution if no color is specified
  let targetColor = color;
  if (!targetColor) {
    targetColor = Math.random() < 0.5 ? 'w' : 'b';
  }

  // Fetch candidates for targetColor
  let candidates = await fetchBookCandidates(lineIds, targetColor);
  const solved = await fetchSolvedFens();
  let active = candidates.filter(c => !solved.has(normalizeBookFen(c.fen)));

  // Fallback to the other color if no active candidates exist for targetColor and no color was specified
  if (active.length === 0 && !color) {
    const fallbackColor = targetColor === 'w' ? 'b' : 'w';
    candidates = await fetchBookCandidates(lineIds, fallbackColor);
    active = candidates.filter(c => !solved.has(normalizeBookFen(c.fen)));
  }

  if (active.length === 0) {
    return retryBookPuzzle(openingId, color, days, isRetry);
  }

  // Sample up to 200 candidates to lookup play count in position_moves
  const sampleSize = Math.min(200, active.length);
  const samples: typeof active = [];
  const sampleIndices = new Set<number>();
  while (samples.length < sampleSize) {
    const idx = Math.floor(Math.random() * active.length);
    if (!sampleIndices.has(idx)) {
      sampleIndices.add(idx);
      samples.push(active[idx]);
    }
  }

  // Group by normalized 3-part FEN (piece placement, active color, castling rights)
  const normFenToSamples = new Map<string, typeof active>();
  samples.forEach(s => {
    const parts = s.fen.split(' ');
    const norm = `${parts[0]} ${parts[1]} ${parts[2]}`;
    if (!normFenToSamples.has(norm)) {
      normFenToSamples.set(norm, []);
    }
    normFenToSamples.get(norm)!.push(s);
  });

  const uniqueNormFens = Array.from(normFenToSamples.keys());
  const playCountsMap = new Map<string, number>();

  if (uniqueNormFens.length > 0) {
    const placeholders = uniqueNormFens.map(() => '?').join(',');
    const querySql = `
      SELECT fen_norm, SUM(wins + draws + losses) as play_count
      FROM position_moves
      WHERE fen_norm IN (${placeholders})
      GROUP BY fen_norm
    `;
    const rs = await turso.execute({ sql: querySql, args: uniqueNormFens });
    rs.rows.forEach(r => {
      playCountsMap.set(String(r.fen_norm), Number(r.play_count));
    });
  }

  // Calculate weights using smooth logarithmic scale: weight = 1 + log2(1 + count) * 5
  let totalWeight = 0;
  const weightedSamples = samples.map(s => {
    const parts = s.fen.split(' ');
    const norm = `${parts[0]} ${parts[1]} ${parts[2]}`;
    const count = playCountsMap.get(norm) || 0;
    const weight = 1 + Math.log2(1 + count) * 5;
    totalWeight += weight;
    return { candidate: s, weight };
  });

  // Weighted random selection
  let r = Math.random() * totalWeight;
  let selected = weightedSamples[weightedSamples.length - 1].candidate;
  for (const item of weightedSamples) {
    r -= item.weight;
    if (r <= 0) {
      selected = item.candidate;
      break;
    }
  }

  return buildBookPuzzleFromCandidate(selected);
}

function getGamePlyForFen(pgn: string, targetFen3: string): number {
  const chess = new Chess();
  try {
    chess.loadPgn(preprocessPgn(pgn).trim());
    const history = chess.history({ verbose: true });
    const startFen = chess.header().FEN || chess.header().Fen || STARTING_FEN;
    const temp = new Chess(startFen);
    
    const startParts = temp.fen().split(' ');
    const start3 = `${startParts[0]} ${startParts[1]} ${startParts[2]}`;
    if (start3 === targetFen3) {
      return 0;
    }

    let ply = 0;
    for (const m of history) {
      temp.move(m.san);
      ply++;
      const parts = temp.fen().split(' ');
      const p3 = `${parts[0]} ${parts[1]} ${parts[2]}`;
      if (p3 === targetFen3) {
        return ply;
      }
    }
  } catch (e) {
    // ignore
  }
  return -1;
}

async function fetchRawWeakMoves(openingId?: number, color?: string, days?: number) {
  let sql = `SELECT pm.*, g.pgn, g.white_name, g.black_name, g.played_date FROM position_moves pm JOIN games g ON pm.game_id = g.id WHERE pm.game_id IS NOT NULL AND (pm.losses > pm.wins OR pm.losses >= 2)`;
  const args: any[] = [];
  if (openingId !== undefined) { sql += ' AND g.opening_id = ?'; args.push(openingId); }
  if (color !== undefined) { sql += ' AND g.user_color = ?'; args.push(color); }
  if (days !== undefined) { sql += ' AND g.played_date >= ?'; args.push(getDateDaysAgo(days)); }
  sql += ' ORDER BY RANDOM() LIMIT 200';
  return (await turso.execute({ sql, args })).rows;
}

async function fetchCachedAnalysis(fens: string[]) {
  if (fens.length === 0) return [];
  const placeholders = fens.map(() => '?').join(',');
  const sql = `
    SELECT fen_norm, multipv, limit_value, result_json 
    FROM analysis 
    WHERE engine = 'sf18' 
      AND limit_type = 'depth' 
      AND (multipv = 1 OR multipv = 4) 
      AND fen_norm IN (${placeholders})
  `;
  const rs = await turso.execute({ sql, args: fens });
  
  const group: Record<string, any> = {};
  rs.rows.forEach(row => {
    const fen = String(row.fen_norm);
    const existing = group[fen];
    if (!existing) {
      group[fen] = row;
    } else {
      const extM = Number(existing.multipv);
      const rowM = Number(row.multipv);
      if (rowM > extM || (rowM === extM && Number(row.limit_value) > Number(existing.limit_value))) {
        group[fen] = row;
      }
    }
  });
  return Object.values(group);
}

async function fetchPuzzleStatsForFens(fens: string[]) {
  if (fens.length === 0) return new Map<string, any>();
  const placeholders = fens.map(() => '?').join(',');
  const sql = `SELECT start_fen, mistakes, last_result FROM puzzle_stats WHERE start_fen IN (${placeholders})`;
  const rs = await turso.execute({ sql, args: fens });
  const map = new Map<string, any>();
  rs.rows.forEach(r => map.set(String(r.start_fen), { mistakes: Number(r.mistakes || 0), lastResult: r.last_result }));
  return map;
}

function mapCandidate(r: any, pm: any, ev: any, statsMap: Map<string, any>) {
  const s = statsMap.get(String(r.fen_norm)) || { mistakes: 0, lastResult: null };
  return {
    fen: String(r.fen_norm), playedUci: String(pm.uci), playedSan: String(pm.san),
    engineBestMove: ev.bestMove, wins: Number(pm.wins || 0), draws: Number(pm.draws || 0),
    losses: Number(pm.losses || 0), gameId: Number(pm.game_id), evalData: ev,
    mistakes: s.mistakes, lastResult: s.lastResult, pgn: String(pm.pgn),
    whiteName: String(pm.white_name), blackName: String(pm.black_name), playedDate: String(pm.played_date)
  };
}

function buildWeaknessCandidates(analysisRows: any[], fenMap: Map<string, any>, statsMap: Map<string, any>) {
  return analysisRows.map(r => {
    const pm = fenMap.get(String(r.fen_norm));
    if (!pm) return null;
    const ev = JSON.parse(r.result_json as string);
    if (ev.bestMove && ev.bestMove !== String(pm.uci) && ev.candidates && ev.candidates.length > 0) {
      const bestScore = getCandScore(ev.candidates[0]);
      let playedScore: number | null = null;
      for (const cand of ev.candidates) {
        if (cand.bestMove === String(pm.uci)) {
          playedScore = getCandScore(cand);
          break;
        }
      }
      if (playedScore === null) {
        const worstCand = ev.candidates[ev.candidates.length - 1];
        playedScore = getCandScore(worstCand) - 50;
      }
      if (bestScore - playedScore >= 100) {
        return mapCandidate(r, pm, ev, statsMap);
      }
    }
    return null;
  }).filter(Boolean) as any[];
}

const getCandidateWeight = (c: any) => Math.max(1, c.losses - c.wins) * (1 + c.mistakes * 5) * (c.lastResult === 'success' ? 0.02 : 1);

function chooseWeightedCandidate(candidates: any[]) {
  const weights = candidates.map(getCandidateWeight);
  const total = weights.reduce((a, b) => a + b, 0);
  let rand = Math.random() * total;
  const idx = candidates.findIndex((_, i) => (rand -= weights[i]) <= 0);
  return candidates[idx !== -1 ? idx : 0];
}

const filterCandidatesByPly = async (candidates: any[]) => {
  let list = candidates;
  while (list.length > 0) {
    const sel = chooseWeightedCandidate(list);
    const ply = getGamePlyForFen(sel.pgn, sel.fen.split(' ').slice(0, 3).join(' '));
    if (ply >= 6) return sel;
    list = list.filter(c => c !== sel);
  }
  return null;
};

const buildWeaknessPuzzleObject = (s: any, solutionSan: string) => ({
  id: -300000 - s.gameId * 100 - Math.floor(Math.random() * 100),
  type: 'weakness', game_id: s.gameId, start_fen: s.fen,
  solution_uci: s.engineBestMove, solution_san: solutionSan, player_color: s.fen.split(' ')[1],
  description: `You played ${s.playedSan} in the game which led to a loss. Find the best move!`,
  blunder_uci: s.playedUci, blunder_san: s.playedSan,
  game_title: `${s.whiteName} vs ${s.blackName} (${s.playedDate})`, game_pgn: s.pgn
});

async function buildWeaknessPuzzleResult(s: any) {
  const solutionSan = getSan(s.fen, s.engineBestMove);
  return {
    puzzle: buildWeaknessPuzzleObject(s, solutionSan),
    evaluation: s.evalData,
    bookLine: await fetchBookLineForGame(s.pgn, s.fen)
  };
}

async function retryWeaknessPuzzle(openingId?: number, color?: string, days?: number, totalCount?: number, isRetry = false) {
  if (totalCount !== undefined && totalCount > 0 && !isRetry) {
    await turso.execute("DELETE FROM puzzle_stats WHERE start_fen IN (SELECT DISTINCT fen_norm FROM position_moves)");
    return fetchWeaknessPuzzle(openingId, color, days, true);
  }
  return null;
}

async function fetchWeaknessPuzzle(openingId?: number, color?: string, days?: number, isRetry = false): Promise<any> {
  const raw = await fetchRawWeakMoves(openingId, color, days);
  if (raw.length === 0) return null;
  const analysis = await fetchCachedAnalysis(raw.map(r => String(r.fen_norm) + ' -'));
  const cand = buildWeaknessCandidates(analysis, new Map(raw.map(r => [String(r.fen_norm) + ' -', r])), await fetchPuzzleStatsForFens(analysis.map(r => String(r.fen_norm))));
  const active = cand.filter(c => c.lastResult !== 'success');
  if (active.length === 0) return retryWeaknessPuzzle(openingId, color, days, cand.length, isRetry);
  const sel = await filterCandidatesByPly(active);
  return sel ? buildWeaknessPuzzleResult(sel) : null;
}

async function fetchBrilliantPuzzle(openingId?: number, color?: string, days?: number) {
  let sql = 'SELECT bm.*, g.pgn FROM brilliant_moves bm JOIN games g ON bm.game_id = g.id WHERE 1=1';
  const args: any[] = [];
  if (openingId) {
    sql += ' AND g.opening_id = ?';
    args.push(openingId);
  }
  if (color) {
    sql += ' AND bm.player_color = ?';
    args.push(color);
  }
  if (days) {
    sql += ` AND g.played_date >= date('now', '-${days} days')`;
  }
  sql += ' ORDER BY RANDOM() LIMIT 1';
  
  const rs = await turso.execute({ sql, args });
  if (rs.rows.length === 0) return null;
  
  const r = rs.rows[0];
  return {
    id: -500000 - Number(r.id),
    type: 'brilliant',
    game_id: r.game_id,
    start_fen: r.fen_before,
    solution_uci: r.played_uci,
    solution_san: r.played_san,
    best_uci: r.played_uci,
    best_san: r.played_san,
    user_color: r.player_color,
    description: `You played a brilliant sacrifice here! Can you find it again?`,
    blunder_uci: '',
    blunder_san: '',
    game_title: r.game_title,
    game_pgn: String(r.pgn)
  };
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id');
  const type = req.nextUrl.searchParams.get('type') || 'tactical';
  const openingIdParam = req.nextUrl.searchParams.get('openingId');
  const colorParam = req.nextUrl.searchParams.get('color');
  const daysParam = req.nextUrl.searchParams.get('days');

  const openingId = openingIdParam ? Number(openingIdParam) : undefined;
  const color = colorParam || undefined;
  const days = daysParam ? Number(daysParam) : undefined;

  try {
    if (type === 'book') {
      const data = await fetchBookPuzzle(openingId, color, days);
      if (!data) return NextResponse.json({ error: 'No book puzzles found' }, { status: 404 });
      return NextResponse.json(data);
    }
    if (type === 'weakness') {
      const data = await fetchWeaknessPuzzle(openingId, color, days);
      if (!data) return NextResponse.json({ error: 'No weakness puzzles found' }, { status: 404 });
      return NextResponse.json(data);
    }
    if (type === 'brilliant') {
      const puzzle = await fetchBrilliantPuzzle(openingId, color, days);
      if (!puzzle) return NextResponse.json({ error: 'No brilliant puzzles found' }, { status: 404 });
      const details = await loadPuzzleDetails(puzzle);
      return NextResponse.json({ puzzle, ...details });
    }
    const puzzle = id ? await fetchPuzzleById(id) : await fetchRandomPuzzle(type, openingId, color, days);
    if (!puzzle) return NextResponse.json({ error: 'No puzzles found' }, { status: 404 });
    const details = await loadPuzzleDetails(puzzle);
    const gameResult = await fetchGameForScan(Number(puzzle.game_id));
    const game_pgn = gameResult ? String(gameResult.pgn) : null;
    return NextResponse.json({ puzzle: { ...puzzle, game_pgn }, ...details });
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
  const sql = `
    SELECT fen_norm, multipv, limit_value, result_json 
    FROM analysis 
    WHERE engine = 'sf18' 
      AND limit_type = 'depth' 
      AND (multipv = 1 OR multipv = 4) 
      AND fen_norm IN (${placeholders})
  `;
  const rs = await turso.execute({ sql, args: normFens });
  const map: Record<string, any> = {};
  
  rs.rows.forEach(r => {
    const fen = String(r.fen_norm);
    const existing = map[fen];
    const parsed = JSON.parse(r.result_json as string);
    if (!existing) {
      map[fen] = parsed;
      map[fen]._multipv = Number(r.multipv);
      map[fen]._limit_value = Number(r.limit_value);
    } else {
      const extM = Number(existing._multipv);
      const rowM = Number(r.multipv);
      if (rowM > extM || (rowM === extM && Number(r.limit_value) > Number(existing._limit_value))) {
        map[fen] = parsed;
        map[fen]._multipv = rowM;
        map[fen]._limit_value = Number(r.limit_value);
      }
    }
  });
  
  Object.keys(map).forEach(k => {
    delete map[k]._multipv;
    delete map[k]._limit_value;
  });
  
  return map;
}

function getGameFensAndHistory(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(preprocessPgn(pgn).trim());
  const history = chess.history({ verbose: true });
  const fens = [chess.header().FEN || chess.header().Fen || STARTING_FEN];
  const temp = new Chess(fens[0]);
  for (const m of history) {
    temp.move(m.san);
    fens.push(temp.fen());
  }
  return { history, fens };
}

function detectBlunderDetails(evalBefore: any, evalAfter: any, isWhiteToMove: boolean, ply?: number) {
  const scoreBefore = isWhiteToMove ? evalBefore.cp : -evalBefore.cp;
  const scoreAfter = isWhiteToMove ? evalAfter.cp : -evalAfter.cp;
  if (scoreBefore === undefined || scoreAfter === undefined) return null;
  if (scoreAfter < -400) return null;
  const wpBefore = getWinProbability(scoreBefore), wpAfter = getWinProbability(-scoreAfter);
  const threshold = (ply !== undefined && ply <= 24) ? 0.10 : 0.20;
  return wpBefore - wpAfter >= threshold ? { scoreBefore, scoreAfter } : null;
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

async function insertPuzzle(args: any[], type = 'tactical') {
  const sql = `INSERT OR IGNORE INTO puzzles (game_id, start_fen, solution_uci, solution_san, player_color, description, blunder_uci, blunder_san, game_title, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const rs = await turso.execute({ sql, args: [...args, type] });
  return rs.rowsAffected > 0;
}

function getCandScore(cand: any): number {
  if (cand.mate !== undefined && cand.mate !== null) {
    return cand.mate > 0 ? 10000 - cand.mate : -10000 - cand.mate;
  }
  return cand.cp ?? cand.score ?? 0;
}

function detectZwischenzug(
  startFen: string,
  bestUci: string,
  evalAtStart: any,
  prevMove: any
) {
  if (!evalAtStart || !evalAtStart.candidates || evalAtStart.candidates.length === 0) {
    return null;
  }

  const isCapture = prevMove && (prevMove.captured !== undefined || prevMove.san.includes('x'));
  
  const chess = new Chess(startFen);
  const colorToMove = chess.turn();
  const opponentColor = colorToMove === 'w' ? 'b' : 'w';

  let isThreat = false;
  let threatenedPieceSquare: string | null = null;
  let threatenedPieceType: string | null = null;

  if (!isCapture) {
    const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    
    for (const r of ranks) {
      for (const f of files) {
        const sq = f + r;
        const piece = chess.get(sq as any);
        if (piece && piece.color === colorToMove) {
          if (chess.isAttacked(sq as any, opponentColor)) {
            const isHighValue = ['q', 'r', 'b', 'n'].includes(piece.type);
            if (isHighValue || piece.type === 'p') {
              isThreat = true;
              threatenedPieceSquare = sq;
              threatenedPieceType = piece.type;
              break;
            }
          }
        }
      }
      if (isThreat) break;
    }
  }

  if (!isCapture && !isThreat) {
    return null;
  }

  const naturalMoves: string[] = [];
  const allLegalMoves = chess.moves({ verbose: true });

  if (isCapture && prevMove) {
    const captureSq = prevMove.to;
    allLegalMoves.forEach(m => {
      if (m.to === captureSq) {
        naturalMoves.push(m.from + m.to + (m.promotion || ''));
      }
    });
  } else if (isThreat && threatenedPieceSquare) {
    allLegalMoves.forEach(m => {
      if (m.from === threatenedPieceSquare) {
        naturalMoves.push(m.from + m.to + (m.promotion || ''));
      }
    });
  }

  if (naturalMoves.length === 0) {
    return null;
  }

  if (naturalMoves.includes(bestUci)) {
    return null;
  }

  const bestCand = evalAtStart.candidates[0];
  const bestScore = getCandScore(bestCand);

  let naturalScore: number | null = null;
  for (const cand of evalAtStart.candidates) {
    if (naturalMoves.includes(cand.bestMove)) {
      naturalScore = getCandScore(cand);
      break;
    }
  }

  if (naturalScore === null) {
    const worstCand = evalAtStart.candidates[evalAtStart.candidates.length - 1];
    naturalScore = getCandScore(worstCand) - 50;
  }

  if (bestScore - naturalScore >= 150) {
    const testChess = new Chess(startFen);
    try {
      const moveResult = testChess.move({
        from: bestUci.slice(0, 2),
        to: bestUci.slice(2, 4),
        promotion: bestUci[4]
      });
      const isForcing = testChess.inCheck() || moveResult.captured || moveResult.san.includes('+') || moveResult.san.includes('#');
      if (isForcing || bestScore - naturalScore >= 200) {
        return {
          solution_san: moveResult ? moveResult.san : bestUci,
          naturalUci: naturalMoves[0],
          naturalSan: getSan(startFen, naturalMoves[0]),
          isCapture,
          threatenedPieceType,
          threatenedPieceSquare,
          bestScore,
          naturalScore
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function isEndgameFen(fen: string): boolean {
  const board = fen.split(' ')[0];
  const pieces = board.match(/[qrbnQRBN]/g);
  return !pieces || pieces.length <= 4;
}

function getSideToMoveScore(ev: any): number {
  if (ev.mate !== undefined && ev.mate !== null) {
    return ev.mate > 0 ? 10000 : -10000;
  }
  return ev.cp ?? ev.score ?? 0;
}

function getPuzzleType(fen: string, ply: number, isOpp: boolean, ev: any): string {
  if (ev.mate !== undefined && ev.mate !== null && ev.mate > 0 && ev.mate <= 9) return 'checkmate';
  if (isEndgameFen(fen)) return 'endgame';
  const score = getSideToMoveScore(ev);
  if (score >= 200) return 'winning_position';
  if (ply <= 24 && !isOpp && score >= -150) return 'opening';
  return score < -100 ? 'defensive' : 'tactical';
}

function getPuzzleDescription(type: string, isOpp: boolean, san: string): string {
  if (type === 'checkmate') return isOpp ? `Opponent blundered. Find the forced mate!` : `Find the forced mate!`;
  if (type === 'endgame') return isOpp ? `Opponent blundered. Find the winning endgame technique!` : `Endgame challenge: Find the best move to convert this endgame!`;
  if (type === 'winning_position') return isOpp ? `Opponent blundered. Find the clinical winning sequence!` : `You had a winning position. Find the correct winning move!`;
  if (type === 'opening') return `Opening challenge: Find the correct move to get a playable game out of the opening!`;
  if (type === 'defensive') return isOpp ? `Opponent threatened you. Find the precise defensive response to hold the game!` : `You were under pressure. Find the precise saving move!`;
  return isOpp ? `Opponent played ${san}. Find the winning response!` : `You played ${san} in the game. Find the correct move instead!`;
}

function isBlunder(eb: any, ea: any, isWhite: boolean, ply?: number): boolean {
  return eb && ea && !!detectBlunderDetails(eb, ea, isWhite, ply);
}

async function handleZw(game: any, startFen: string, bestUci: string, evalAtStart: any, prevMove: any, uUserColor: string) {
  const zw = detectZwischenzug(startFen, bestUci, evalAtStart, prevMove);
  if (!zw) return null;
  const gameTitle = `${game.white_name} vs ${game.black_name} (${game.played_date})`;
  const desc = zw.isCapture
    ? `Opponent captured on ${prevMove.to}. Find the intermediate move (zwischenzug) instead of recapturing!`
    : `Opponent threatened your ${zw.threatenedPieceType === 'p' ? 'pawn' : zw.threatenedPieceType === 'q' ? 'queen' : zw.threatenedPieceType === 'r' ? 'rook' : zw.threatenedPieceType === 'b' ? 'bishop' : 'knight'}. Find the intermediate move (zwischenzug) instead of directly defending!`;
  return await insertPuzzle([game.id, startFen, bestUci, zw.solution_san, uUserColor, desc, zw.naturalUci, zw.naturalSan, gameTitle], 'zwischenzug');
}

function extractForcingSequence(startFen: string, bestUci: string, pvStrs: string[], playerColor: string): { uci: string, san: string } {
  const chess = new Chess(startFen);
  const uciSeq: string[] = [];
  const sanSeq: string[] = [];
  
  if (!pvStrs || pvStrs.length === 0) return { uci: bestUci, san: getSan(startFen, bestUci) };

  for (let i = 0; i < pvStrs.length; i++) {
    const moveStr = pvStrs[i];
    if (moveStr.length < 4) break;
    const mObj = { from: moveStr.slice(0, 2), to: moveStr.slice(2, 4), promotion: moveStr[4] };
    
    let move;
    try {
      move = chess.move(mObj);
    } catch {
      break;
    }
    
    if (!move) break;

    const isUserTurn = chess.turn() !== playerColor;
    
    uciSeq.push(moveStr);
    sanSeq.push(move.san);

    if (isUserTurn) {
      const isForcing = move.captured !== undefined || move.san.includes('+') || move.san.includes('#');
      if (!isForcing) break;
    }
  }

  if (uciSeq.length % 2 === 0) {
    uciSeq.pop();
    sanSeq.pop();
  }

  return uciSeq.length > 0 ? { uci: uciSeq.join(','), san: sanSeq.join(',') } : { uci: bestUci, san: getSan(startFen, bestUci) };
}

async function handleStd(game: any, startFen: string, bestUci: string, i: number, isOpponent: boolean, evalAtStart: any, blunderUci: string, blunderSan: string, uUserColor: string) {
  const gameTitle = `${game.white_name} vs ${game.black_name} (${game.played_date})`;
  const puzzleType = getPuzzleType(startFen, i, isOpponent, evalAtStart);
  const desc = getPuzzleDescription(puzzleType, isOpponent, blunderSan);
  
  const playerColorToMove = startFen.split(' ')[1];
  
  const useSequence = puzzleType === 'tactical' || puzzleType === 'checkmate';
  const seq = useSequence 
    ? extractForcingSequence(startFen, bestUci, evalAtStart.pv, playerColorToMove)
    : { uci: bestUci, san: getSan(startFen, bestUci) };
  
  const row = [game.id, startFen, seq.uci, seq.san, uUserColor, desc, blunderUci, blunderSan, gameTitle];
  return await insertPuzzle(row, puzzleType);
}

async function insertBrilliantMove(gameId: number, fenBefore: string, fenAfter: string, playedUci: string, playedSan: string, playerColor: string, gameTitle: string) {
  try {
    const checkSql = `SELECT 1 FROM brilliant_moves WHERE game_id = ? AND fen_before = ? LIMIT 1`;
    const checkRs = await turso.execute({ sql: checkSql, args: [gameId, fenBefore] });
    if (checkRs.rows.length > 0) return true; // Already exists

    const sql = `INSERT INTO brilliant_moves (game_id, fen_before, fen_after, played_uci, played_san, player_color, game_title) VALUES (?, ?, ?, ?, ?, ?, ?)`;
    await turso.execute({ sql, args: [gameId, fenBefore, fenAfter, playedUci, playedSan, playerColor, gameTitle] });
    return true;
  } catch (err) {
    return false;
  }
}

async function fetchBookMovesForFens(fens: string[]): Promise<Set<string>> {
  const bookFens = fens.map(normalizeBookFen);
  const placeholders = bookFens.map(() => '?').join(',');
  const sql = `SELECT fen_before, uci FROM book_moves WHERE fen_before IN (${placeholders})`;
  const rs = await turso.execute({ sql, args: bookFens });
  const set = new Set<string>();
  rs.rows.forEach(r => set.add(`${String(r.fen_before)}|${String(r.uci)}`));
  return set;
}

async function processMoveIndex(game: any, history: any[], fens: string[], normFens: string[], evalMap: any, i: number, uUserColor: string, bookMoves: Set<string>) {
  if (history[i].san.endsWith('#')) return false;
  const eb = evalMap[normFens[i]], ea = evalMap[normFens[i + 1]], isWhite = normFens[i].split(' ')[1] === 'w';
  const playerColor = isWhite ? 'w' : 'b';
  const isOpp = playerColor !== uUserColor;
  
  if (!isOpp && eb && ea && ea.pv) {
    const cpBefore = getSideToMoveScore(eb);
    const cpAfter = -getSideToMoveScore(ea);
    const wpBefore = getWinProbability(cpBefore);
    const wpAfter = getWinProbability(cpAfter);
    const wpLoss = wpBefore - wpAfter;
    if (wpLoss <= 0.05 && wpAfter >= 0.20 && Math.abs(cpBefore) <= 800) {
      const playedUci = history[i].from + history[i].to + (history[i].promotion || '');
      const isBookMove = bookMoves.has(`${normalizeBookFen(fens[i])}|${playedUci}`);
      const isPrevCheck = i > 0 && history[i - 1].san.includes('+');
      if (!isBookMove && !isPrevCheck && isSacrifice(fens[i], fens[i + 1], ea.pv, playerColor)) {
        const gameTitle = `${game.white_name} vs ${game.black_name} (${game.played_date})`;
        await insertBrilliantMove(game.id, fens[i], fens[i+1], playedUci, history[i].san, playerColor, gameTitle);
      }
    }
  }

  if (!isBlunder(eb, ea, isWhite, i)) return false;
  const start = isOpp ? fens[i + 1] : fens[i], bestUci = isOpp ? ea.bestMove : eb.bestMove;
  if (!bestUci || bookMoves.has(`${normalizeBookFen(fens[i])}|${history[i].from}${history[i].to}${history[i].promotion || ''}`)) return false;
  const playedUci = history[i].from + history[i].to + (history[i].promotion || '');
  if (!isOpp && bestUci === playedUci) return false;
  const zw = await handleZw(game, start, bestUci, isOpp ? ea : eb, isOpp ? history[i] : (history[i - 1] || null), uUserColor);
  return zw !== null ? zw : await handleStd(game, start, bestUci, i, isOpp, isOpp ? ea : eb, playedUci, history[i].san, uUserColor);
}

async function scanGame(gameId: number) {
  const game = await fetchGameForScan(gameId);
  if (!game) return 0;
  const { history, fens } = getGameFensAndHistory(game.pgn as string);
  const normFens = fens.map(normalizeFen), evalMap = await fetchCachedEvalsForFens(normFens);
  const bookMoves = await fetchBookMovesForFens(fens);
  const uColor = (game.user_color as string) || (isUserBlack(String(game.black_name || '')) ? 'b' : 'w');
  const results = await Promise.all(history.map((_, i) => processMoveIndex(game, history, fens, normFens, evalMap, i, uColor, bookMoves)));
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
