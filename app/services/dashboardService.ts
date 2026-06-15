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
  const monday = getMondayDate(String(r.played_date));
  const target = speed === 'blitz' ? eloHistory.blitzMap : eloHistory.rapidMap;
  target.set(monday, elo);
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

export function processEloAndOutcomes(games: any[]) {
  const stats = {
    blitz: { wins: 0, draws: 0, losses: 0, white: { wins: 0, draws: 0, losses: 0 }, black: { wins: 0, draws: 0, losses: 0 } },
    rapid: { wins: 0, draws: 0, losses: 0, white: { wins: 0, draws: 0, losses: 0 }, black: { wins: 0, draws: 0, losses: 0 } },
    all: { wins: 0, draws: 0, losses: 0 }
  };
  const eloHistory = { blitzMap: new Map<string, number>(), rapidMap: new Map<string, number>() };
  games.forEach(r => processGameRow(r, stats, eloHistory));
  return { stats, eloHistory: { blitz: mapToList(eloHistory.blitzMap), rapid: mapToList(eloHistory.rapidMap) } };
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

export async function getDashboardData() {
  const [games, notes, bookLines, bookMoves, puzzles, pStats, openings, gamesList, opStats] = await Promise.all([
    getGamesCount(), getNotesCount(), getBookLinesCount(), getBookMovesCount(),
    getPuzzlesCount(), getPuzzleStats(), getTopOpenings(), fetchGamesForDashboard(),
    fetchOpeningStats()
  ]);
  const processed = processEloAndOutcomes(gamesList);
  return { counts: { games, notes, bookLines, bookMoves, puzzles, puzzleStats: pStats }, openings, openingsStats: opStats, ...processed };
}
