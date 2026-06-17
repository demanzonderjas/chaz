import { turso } from './turso';

export async function getGamesCount() {
  const rs = await turso.execute('SELECT COUNT(*) as count FROM games');
  return Number(rs.rows[0]?.count || 0);
}

export async function getNotesCount() {
  const rs = await turso.execute('SELECT COUNT(*) as count FROM position_comments');
  return Number(rs.rows[0]?.count || 0);
}

export async function getBookLinesCount() {
  const rs = await turso.execute('SELECT COUNT(*) as count FROM book_lines');
  return Number(rs.rows[0]?.count || 0);
}

export async function getBookMovesCount() {
  const rs = await turso.execute('SELECT COUNT(*) as count FROM book_moves');
  return Number(rs.rows[0]?.count || 0);
}

export async function getPuzzlesCount() {
  const rs = await turso.execute('SELECT COUNT(*) as count FROM puzzles');
  return Number(rs.rows[0]?.count || 0);
}

export async function getPuzzleStats() {
  const rs = await turso.execute('SELECT COUNT(*) as total, SUM(mistakes) as total_mistakes FROM puzzle_stats');
  const succ = await turso.execute("SELECT COUNT(*) as count FROM puzzle_stats WHERE last_result = 'success'");
  return {
    attempts: Number(rs.rows[0]?.total || 0),
    completed: Number(succ.rows[0]?.count || 0),
    mistakes: Number(rs.rows[0]?.total_mistakes || 0),
  };
}

export async function getTopOpenings() {
  const q = 'SELECT o.name, COUNT(g.id) as count FROM games g JOIN openings o ON g.opening_id = o.id GROUP BY g.opening_id ORDER BY count DESC LIMIT 5';
  const rs = await turso.execute(q);
  return rs.rows.map(r => ({ name: String(r.name), count: Number(r.count) }));
}

export async function fetchGamesForDashboard() {
  const q = 'SELECT result, user_color, white_elo, black_elo, pgn, played_date FROM games ORDER BY played_date ASC, id ASC';
  const rs = await turso.execute(q);
  return rs.rows;
}

function getSpeedFromEvent(event: string) {
  if (event.includes('blitz')) return 'blitz';
  if (event.includes('rapid')) return 'rapid';
  if (event.includes('bullet')) return 'bullet';
  return null;
}

function getSpeedFromTime(baseTime: number) {
  if (baseTime < 180) return 'bullet';
  if (baseTime < 600) return 'blitz';
  if (baseTime < 3600) return 'rapid';
  return 'classical';
}

function getGameSpeed(pgn: string) {
  const ev = (pgn.match(/\[Event\s+"([^"]+)"\]/i)?.[1] || '').toLowerCase();
  const speed = getSpeedFromEvent(ev);
  if (speed) return speed;
  const tc = pgn.match(/\[TimeControl\s+"([^"]+)"\]/i)?.[1] || '';
  const base = parseInt(tc.split('+')[0], 10);
  return isNaN(base) ? 'classical' : getSpeedFromTime(base);
}

function getMoveOutcome(result: string, userColor: string) {
  if (result === '1/2-1/2') return 'draw';
  if ((result === '1-0' && userColor === 'w') || (result === '0-1' && userColor === 'b')) return 'win';
  return 'loss';
}

function incrementStat(obj: any, outcome: string) {
  if (outcome === 'win') obj.wins++;
  else if (outcome === 'draw') obj.draws++;
  else if (outcome === 'loss') obj.losses++;
}

function getRowElo(r: any) {
  return r.user_color === 'w' ? Number(r.white_elo) : Number(r.black_elo);
}

function updateStatsForSpeed(stats: any, speed: string, outcome: string, userColor: string) {
  const target = speed === 'blitz' ? stats.blitz : (speed === 'rapid' ? stats.rapid : null);
  if (target) {
    incrementStat(target, outcome);
    incrementStat(userColor === 'w' ? target.white : target.black, outcome);
  }
}

function getMondayDate(dateStr: string) {
  const d = new Date(dateStr.replace(/\./g, '-'));
  if (isNaN(d.getTime())) return dateStr;
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split('T')[0];
}

function recordElo(r: any, speed: string, eloHistory: any) {
  const elo = getRowElo(r);
  if (!elo || isNaN(elo)) return;
  const dateStr = String(r.played_date).replace(/\./g, '-');
  const target = speed === 'blitz' ? eloHistory.blitz : eloHistory.rapid;
  target.daily.set(dateStr, elo);
  target.weekly.set(getMondayDate(dateStr), elo);
}

function processGameRow(r: any, stats: any, eloHistory: any) {
  const outcome = getMoveOutcome(String(r.result), String(r.user_color));
  const speed = getGameSpeed(String(r.pgn));
  incrementStat(stats.all, outcome);
  updateStatsForSpeed(stats, speed, outcome, String(r.user_color));
  recordElo(r, speed, eloHistory);
}

function mapToList(map: Map<string, number>) {
  return Array.from(map.entries()).map(([date, elo]) => ({ date, elo }));
}

function createInitStats() {
  const empty = { wins: 0, draws: 0, losses: 0 };
  const player = { wins: 0, draws: 0, losses: 0, white: { ...empty }, black: { ...empty } };
  return { blitz: { ...player }, rapid: { ...player }, all: { ...empty } };
}

function createInitElo() {
  return {
    blitz: { daily: new Map<string, number>(), weekly: new Map<string, number>() },
    rapid: { daily: new Map<string, number>(), weekly: new Map<string, number>() }
  };
}

function formatEloHistory(elo: any) {
  return {
    blitz: { daily: mapToList(elo.blitz.daily), weekly: mapToList(elo.blitz.weekly) },
    rapid: { daily: mapToList(elo.rapid.daily), weekly: mapToList(elo.rapid.weekly) }
  };
}

export function processEloAndOutcomes(games: any[]) {
  const stats = createInitStats();
  const elo = createInitElo();
  games.forEach(r => processGameRow(r, stats, elo));
  return { stats, eloHistory: formatEloHistory(elo) };
}

export async function fetchOpeningStats() {
  const q = 'SELECT o.name as opening_name, g.user_color, g.result, g.played_date FROM games g JOIN openings o ON g.opening_id = o.id';
  const rs = await turso.execute(q);
  return rs.rows.map(r => ({
    name: String(r.opening_name),
    color: String(r.user_color),
    result: String(r.result),
    date: String(r.played_date)
  }));
}

function getDaysAgoDate(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0].replace(/-/g, '.');
}

interface Pattern {
  prefix: string;
  name: string;
}

const MOVE_PATTERNS: Pattern[] = [
  { prefix: 'e2e4 c7c5', name: 'Sicilian Defence' },
  { prefix: 'e2e4 e7e6', name: 'French Defence' },
  { prefix: 'e2e4 c7c6', name: 'Caro-Kann Defence' },
  { prefix: 'e2e4 d7d5', name: 'Scandinavian Defence' },
  { prefix: 'e2e4 b8c6', name: 'Nimzowitsch Defence' },
  { prefix: 'e2e4 d7d6', name: 'Pirc / Modern Defence' },
  { prefix: 'e2e4 g7g6', name: 'Pirc / Modern Defence' },
  { prefix: 'e2e4 g8f6', name: 'Alekhine Defence' },
  { prefix: 'e2e4 e7e5 g1f3 b8c6 f1b5', name: 'Ruy Lopez' },
  { prefix: 'e2e4 e7e5 g1f3 b8c6 f1c4', name: 'Italian Game' },
  { prefix: 'd2d4 d7d5 c2c4', name: "Queen's Gambit" },
  { prefix: 'd2d4 g8f6 c2c4 g7g6', name: "King's Indian / Grunfeld" },
  { prefix: 'd2d4 g8f6 c2c4 e7e6', name: 'Indian Defences' },
  { prefix: 'd2d4 f7f5', name: 'Dutch Defence' },
  { prefix: 'c2c4', name: 'English Opening' },
  { prefix: 'g1f3', name: 'Reti / KIA' }
];

interface NamePattern {
  keywords: string[];
  name: string;
}

const NAME_PATTERNS: NamePattern[] = [
  { keywords: ['caveman', 'lion'], name: 'The Black Lion' },
  { keywords: ['alekhine'], name: 'Alekhine Defence' },
  { keywords: ['scandinavian'], name: 'Scandinavian Defence' },
  { keywords: ['pirc', 'modern'], name: 'Pirc / Modern Defence' },
  { keywords: ['nimzowitsch'], name: 'Nimzowitsch Defence' },
  { keywords: ['london'], name: 'London System' },
  { keywords: ['english', 'reti'], name: 'English & Reti' },
  { keywords: ['staunton', 'dutch'], name: 'Dutch Defence' },
  { keywords: ['french'], name: 'French Defence' },
  { keywords: ['sicilian'], name: 'Sicilian Defence' },
  { keywords: ['caro-kann', 'caro'], name: 'Caro-Kann Defence' },
  { keywords: ['italian', 'bc4'], name: 'Italian Game' },
  { keywords: ['ruy', 'bb5'], name: 'Ruy Lopez' },
  { keywords: ['gambit'], name: 'Other Gambits' }
];

function classifyByMoves(moveStr: string): string | null {
  const match = MOVE_PATTERNS.find(p => moveStr.startsWith(p.prefix));
  return match ? match.name : null;
}

function classifyByName(name: string): string {
  const lowercaseName = name.toLowerCase();
  const match = NAME_PATTERNS.find(p => p.keywords.some(k => lowercaseName.includes(k)));
  return match ? match.name : 'Other / General';
}

function getGeneralOpening(name: string, moveStr: string): string {
  return classifyByMoves(moveStr) || classifyByName(name);
}

function groupMovesByLineId(rows: any[]) {
  const map = new Map<number, string[]>();
  rows.forEach(r => {
    const lid = Number(r.line_id);
    if (!map.has(lid)) map.set(lid, []);
    map.get(lid)!.push(String(r.uci));
  });
  return map;
}

async function fetchMovesMap(ids: number[]) {
  const q = `SELECT line_id, uci FROM book_moves WHERE line_id IN (${ids.join(',')}) AND ply <= 6 ORDER BY line_id, ply ASC`;
  const rs = await turso.execute(q);
  return groupMovesByLineId(rs.rows);
}

function filterDistinctWorstLines(rows: any[], movesMap: Map<number, string[]>) {
  const seen = new Set<string>();
  return rows.filter(r => {
    const moves = movesMap.get(Number(r.id)) || [];
    const category = getGeneralOpening(String(r.name), moves.join(' '));
    if (seen.has(category)) return false;
    seen.add(category);
    return true;
  }).slice(0, 5);
}

export async function fetchWorstBookLines(days?: number) {
  const filter = days ? `AND g.played_date >= '${getDaysAgoDate(days)}'` : '';
  const q = `SELECT bl.id as id, bl.name, bl.color, COUNT(DISTINCT CASE WHEN pm.losses > 0 THEN pm.game_id END) as losses, COUNT(DISTINCT pm.game_id) as played FROM book_lines bl JOIN book_moves bm ON bl.id = bm.line_id JOIN position_moves pm ON pm.fen_norm = SUBSTR(bm.fen_before, 1, LENGTH(bm.fen_before) - CASE WHEN SUBSTR(bm.fen_before, -2, 1) = ' ' THEN 2 ELSE 3 END) JOIN games g ON pm.game_id = g.id WHERE g.result IS NOT NULL ${filter} GROUP BY bl.id HAVING losses > 0 ORDER BY losses DESC, played DESC LIMIT 1000`;
  const rs = await turso.execute(q);
  if (rs.rows.length === 0) return [];
  const movesMap = await fetchMovesMap(rs.rows.map(r => Number(r.id)));
  const filtered = filterDistinctWorstLines(rs.rows, movesMap);
  return filtered.map(r => ({ id: Number(r.id), name: String(r.name), color: String(r.color), losses: Number(r.losses), played: Number(r.played) }));
}


export async function getWorstBookLinesByPeriod() {
  const [all, p7, p30, p90, p365] = await Promise.all([
    fetchWorstBookLines(), fetchWorstBookLines(7), fetchWorstBookLines(30), fetchWorstBookLines(90), fetchWorstBookLines(365)
  ]);
  return { all, "7": p7, "30": p30, "90": p90, "365": p365 };
}

export async function getDashboardData() {
  const [games, notes, bookLines, bookMoves, puzzles, pStats, openings, gamesList, opStats, worstBookLines] = await Promise.all([
    getGamesCount(), getNotesCount(), getBookLinesCount(), getBookMovesCount(),
    getPuzzlesCount(), getPuzzleStats(), getTopOpenings(), fetchGamesForDashboard(),
    fetchOpeningStats(), getWorstBookLinesByPeriod()
  ]);
  const processed = processEloAndOutcomes(gamesList);
  return { counts: { games, notes, bookLines, bookMoves, puzzles, puzzleStats: pStats }, openings, openingsStats: opStats, worstBookLines, ...processed };
}

