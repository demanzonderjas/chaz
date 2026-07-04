'use client';

import React, { useState, useEffect } from 'react';

export const StatCard = ({ title, value, subtext, icon }: any) => (
  <div className="bg-zinc-900/40 border border-zinc-850 hover:border-zinc-700/50 rounded-xl p-4 transition-all hover:-translate-y-0.5 duration-300 relative overflow-hidden group">
    <div className="flex justify-between items-start">
      <div>
        <p className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">{title}</p>
        <h3 className="text-2xl font-extrabold text-zinc-100 mt-1 font-mono tracking-tight">{value}</h3>
      </div>
      <span className="text-lg filter drop-shadow">{icon}</span>
    </div>
    {subtext && <p className="text-zinc-400 text-[11px] mt-2 font-medium truncate">{subtext}</p>}
  </div>
);

function useDashboardData() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch('/api/dashboard')
      .then(r => r.json())
      .then(d => setData(d))
      .catch(e => console.error(e))
      .finally(() => setLoading(false));
  }, []);
  return { data, loading };
}

export function Dashboard({ onExit, onPracticeLine, onViewBrilliantMove }: { onExit: () => void; onPracticeLine?: (id: number) => void; onViewBrilliantMove?: (gameId: number, fenBefore: string) => void }) {
  const { data, loading } = useDashboardData();
  const [speed, setSpeed] = useState<'blitz' | 'rapid'>('rapid');
  if (loading) return <DashboardLoading onExit={onExit} />;
  if (!data) return <DashboardError onExit={onExit} />;
  return <DashboardContent data={data} speed={speed} setSpeed={setSpeed} onExit={onExit} onPracticeLine={onPracticeLine} onViewBrilliantMove={onViewBrilliantMove} />;
}


const DashboardHeader = ({ onExit }: any) => (
  <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-900 shrink-0 font-sans">
    <div>
      <h1 className="text-lg font-bold tracking-tight text-zinc-100 flex items-center gap-2">📊 Chess Activity Dashboard</h1>
      <p className="text-xs text-zinc-500 mt-0.5 font-medium">Detailed insights on your performance and learning progress in Chaz.</p>
    </div>
    <button onClick={onExit} className="text-xs px-3 py-1.5 rounded bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-350 font-bold cursor-pointer transition-all">
      ◀ Back to Analysis
    </button>
  </div>
);

const DashboardLoading = ({ onExit }: any) => (
  <div className="flex-grow flex flex-col bg-zinc-950 text-zinc-100 h-full">
    <DashboardHeader onExit={onExit} />
    <div className="flex-1 flex items-center justify-center">
      <div className="text-zinc-500 text-xs animate-pulse">Loading dashboard metrics...</div>
    </div>
  </div>
);

const DashboardError = ({ onExit }: any) => (
  <div className="flex-grow flex flex-col bg-zinc-955 text-zinc-100 h-full">
    <DashboardHeader onExit={onExit} />
    <div className="flex-1 flex items-center justify-center">
      <div className="text-red-400 text-xs">Failed to load dashboard data. Check database connections.</div>
    </div>
  </div>
);

const StatsDashboardGrid = ({ counts, pRate }: any) => (
  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 px-6 pt-6 shrink-0">
    <StatCard title="Games Imported" value={counts.games} subtext="Total games uploaded" icon="📁" />
    <StatCard title="Book Lines" value={counts.bookLines} subtext={`${counts.bookMoves} moves studied`} icon="📖" />
    <StatCard title="Notes Written" value={counts.notes} subtext="FEN positions annotated" icon="📝" />
    <StatCard title="Puzzles Solved" value={counts.puzzleStats?.completed || 0} subtext={`${counts.puzzleStats?.attempts || 0} puzzle attempts`} icon="🧩" />
    <StatCard title="Puzzle Success" value={`${pRate}%`} subtext={`${counts.puzzleStats?.mistakes || 0} mistakes corrected`} icon="🎯" />
  </div>
);

const EloSpeedToggle = ({ speed, setSpeed }: any) => (
  <div className="flex bg-zinc-900 border border-zinc-850 p-0.5 rounded-lg text-[10px] font-semibold font-sans">
    <button onClick={() => setSpeed('rapid')} className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${speed === 'rapid' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>Rapid</button>
    <button onClick={() => setSpeed('blitz')} className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${speed === 'blitz' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>Blitz</button>
  </div>
);

const EloPeriodToggle = ({ period, setPeriod }: any) => (
  <div className="flex bg-zinc-900 border border-zinc-850 p-0.5 rounded-lg text-[10px] font-semibold font-sans">
    <button onClick={() => setPeriod('7')} className={`px-2 py-1 rounded transition-colors cursor-pointer ${period === '7' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>7D</button>
    <button onClick={() => setPeriod('30')} className={`px-2 py-1 rounded transition-colors cursor-pointer ${period === '30' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>30D</button>
    <button onClick={() => setPeriod('90')} className={`px-2 py-1 rounded transition-colors cursor-pointer ${period === '90' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>90D</button>
    <button onClick={() => setPeriod('365')} className={`px-2 py-1 rounded transition-colors cursor-pointer ${period === '365' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>1Y</button>
    <button onClick={() => setPeriod('all')} className={`px-2 py-1 rounded transition-colors cursor-pointer ${period === 'all' ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`}>All</button>
  </div>
);

const PracticeBadge = ({ color }: { color: string }) => (
  <span className={`text-[9px] px-1 rounded font-bold shrink-0 ${color === 'w' ? 'text-zinc-350 bg-zinc-800' : 'text-zinc-500 bg-zinc-950 border border-zinc-850'}`}>
    {color === 'w' ? 'W' : 'B'}
  </span>
);

const PracticeStats = ({ line }: { line: any }) => (
  <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono">
    <span>Games Played: {line.played}</span>
    <span>Losses: {line.losses}</span>
    <span className="text-rose-455 font-bold">Loss Rate: {line.played > 0 ? ((line.losses / line.played) * 100).toFixed(0) : 0}%</span>
  </div>
);

const PracticeButton = ({ lineId, onClick }: { lineId: number; onClick: (id: number) => void }) => (
  <button onClick={() => onClick(lineId)} className="text-[10px] px-2.5 py-1.5 rounded bg-blue-600/15 hover:bg-blue-600/25 border border-blue-900/30 text-blue-400 hover:text-blue-300 font-bold shrink-0 transition-colors cursor-pointer">
    Practice
  </button>
);

const PracticeRow = ({ line, onPractice }: { line: any; onPractice?: (id: number) => void }) => (
  <div className="pt-3 first:pt-0 flex items-center justify-between gap-4">
    <div className="space-y-1 min-w-0">
      <div className="flex items-center gap-2"><PracticeBadge color={line.color} /><span className="font-semibold text-zinc-200 text-xs truncate block">{line.name}</span></div>
      <PracticeStats line={line} />
    </div>
    {onPractice && <PracticeButton lineId={line.id} onClick={onPractice} />}
  </div>
);

const EmptyPracticeState = () => (
  <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4 font-sans">
    <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Book Lines to Practice</h2>
    <div className="text-zinc-550 text-xs italic py-6 text-center">No practice stats yet. Complete some book puzzles to see personalized recommendations!</div>
  </div>
);

export function BookLinesToPractice({ worstBookLines, onPracticeLine }: { worstBookLines: any[]; onPracticeLine?: (id: number) => void }) {
  if (!worstBookLines || worstBookLines.length === 0) return <EmptyPracticeState />;
  return (
    <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4 font-sans">
      <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Book Lines to Practice</h2>
      <div className="space-y-3 divide-y divide-zinc-900/40">{worstBookLines.map((line) => <PracticeRow key={line.id} line={line} onPractice={onPracticeLine} />)}</div>
    </div>
  );
}

const OutcomeDistribution = ({ speed, stats }: { speed: string; stats: any }) => (
  <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4 font-sans">
    <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Win/Loss Distribution ({speed})</h2>
    <OutcomeBar s={stats} />
    <div className="pt-2 border-t border-zinc-900/80 space-y-3">
      <div><div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1">As White</div><OutcomeBar s={stats.white} /></div>
      <div><div className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1">As Black</div><OutcomeBar s={stats.black} /></div>
    </div>
  </div>
);

const BrilliantMoveRow = ({ move, onView }: { move: any; onView?: (gameId: number, fenBefore: string) => void }) => (
  <button 
    onClick={() => onView?.(move.gameId, move.fenBefore)}
    className="w-full text-left pt-3 first:pt-0 flex items-center justify-between gap-4 hover:bg-zinc-800/40 p-2 -mx-2 rounded transition-colors cursor-pointer"
  >
    <div className="space-y-1 min-w-0">
      <div className="flex items-center gap-2">
        <span className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0 bg-cyan-900/30 text-cyan-400 border border-cyan-800/50">!!</span>
        <span className="font-semibold text-zinc-200 text-xs truncate block">{move.playedSan}</span>
      </div>
      <div className="text-[10px] text-zinc-500 font-mono truncate">{move.gameTitle}</div>
    </div>
  </button>
);

const BrilliantMovesList = ({ moves, onView }: { moves: any[]; onView?: (gameId: number, fenBefore: string) => void }) => (
  <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4 font-sans">
    <div className="flex items-center justify-between">
      <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Brilliant Moves</h2>
      <span className="text-[10px] text-cyan-500 font-mono font-bold bg-cyan-900/20 px-2 py-0.5 rounded-full">{moves.length} found</span>
    </div>
    {moves.length === 0 ? (
      <div className="text-zinc-550 text-xs italic py-6 text-center">No brilliant moves found yet. Keep playing!</div>
    ) : (
      <div className="space-y-1 divide-y divide-zinc-900/40">
        {moves.map(m => <BrilliantMoveRow key={m.id} move={m} onView={onView} />)}
      </div>
    )}
  </div>
);

const DashboardLeftPane = ({ points, period, setPeriod, speed, setSpeed, worstBookLines, onPracticeLine, suggestions, brilliantMoves, onViewBrilliantMove }: any) => (
  <div className="lg:col-span-2 space-y-6">
    <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between"><h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider font-sans">Rating Progress</h2><div className="flex items-center gap-2"><EloPeriodToggle period={period} setPeriod={setPeriod} /><EloSpeedToggle speed={speed} setSpeed={setSpeed} /></div></div>
      <EloGraph points={points} />
    </div>
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <BookLinesToPractice worstBookLines={worstBookLines} onPracticeLine={onPracticeLine} />
      <BrilliantMovesList moves={brilliantMoves} onView={onViewBrilliantMove} />
    </div>
    <DashboardSuggestions suggestions={suggestions} />
  </div>
);

const DashboardRightPane = ({ speed, speedStats, openings, winRates }: any) => (
  <div className="space-y-6">
    <OutcomeDistribution speed={speed} stats={speedStats} />
    <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4"><h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider font-sans">Top Openings Played</h2><OpeningsSection openings={openings} /></div>
    <OpeningsPerformanceStats openings={winRates} />
  </div>
);

const MainDashboardBody = (props: any) => (
  <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
    <DashboardLeftPane points={props.points} period={props.period} setPeriod={props.setPeriod} speed={props.speed} setSpeed={props.setSpeed} worstBookLines={props.worstBookLines} onPracticeLine={props.onPracticeLine} suggestions={props.suggestions} brilliantMoves={props.brilliantMoves} onViewBrilliantMove={props.onViewBrilliantMove} />
    <DashboardRightPane speed={props.speed} speedStats={props.speedStats} openings={props.openings} winRates={props.winRates} />
  </div>
);

const filterDataByPeriod = (items: any[], period: string) => {
  if (period === 'all') return items;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - parseInt(period, 10));
  return items.filter(item => new Date(item.date.replace(/\./g, '-')) >= cutoff);
};

export const DashboardContent = ({ data, speed, setSpeed, onExit, onPracticeLine, onViewBrilliantMove }: any) => {
  const [period, setPeriod] = useState<string>('all');
  const filteredGames = filterDataByPeriod(data.openingsStats || [], period);
  const grouped = groupGamesByOpening(filteredGames);
  const winRates = computeOpeningWinRates(grouped);
  const suggestions = generateSuggestions(winRates);
  const list = (period === '7' || period === '30') ? data.eloHistory?.[speed]?.daily : data.eloHistory?.[speed]?.weekly;
  const points = filterDataByPeriod(list || [], period);
  return <DashboardLayout data={data} speed={speed} setSpeed={setSpeed} period={period} setPeriod={setPeriod} winRates={winRates} suggestions={suggestions} points={points} onExit={onExit} onPracticeLine={onPracticeLine} brilliantMoves={data.brilliantMoves || []} onViewBrilliantMove={onViewBrilliantMove} />;
};

const DashboardLayout = ({ data, speed, setSpeed, period, setPeriod, winRates, suggestions, points, onExit, onPracticeLine, brilliantMoves, onViewBrilliantMove }: any) => {
  const stats = data.stats?.[speed] || { wins: 0, draws: 0, losses: 0, white: {}, black: {} };
  return (
    <div className="flex-grow flex flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <DashboardHeader onExit={onExit} />
      <StatsDashboardGrid counts={data.counts || {}} pRate={getPuzzleSuccessRate(data.counts?.puzzleStats)} />
      <MainDashboardBody points={points} speed={speed} setSpeed={setSpeed} period={period} setPeriod={setPeriod} speedStats={stats} openings={data.openings || []} winRates={winRates} suggestions={suggestions} worstBookLines={data.worstBookLines?.[period] || []} onPracticeLine={onPracticeLine} brilliantMoves={brilliantMoves} onViewBrilliantMove={onViewBrilliantMove} />
    </div>
  );
};

const getX = (i: number, len: number) => 50 + (len > 1 ? (i / (len - 1)) * 630 : 315);
const getY = (elo: number, min: number, max: number) => {
  const d = max - min;
  return 25 + 195 - (d > 0 ? (elo - min) / d : 0.5) * 195;
};

function computeRatingStats(points: any[]) {
  if (!points.length) return { current: 'N/A', peak: 'N/A', low: 'N/A', change: 0 };
  const elos = points.map(p => p.elo);
  const current = elos[elos.length - 1];
  const peak = Math.max(...elos);
  const low = Math.min(...elos);
  const change = current - elos[0];
  return { current, peak, low, change };
}

function getGridLines(min: number, max: number) {
  if (min === max) return [min];
  const step = (max - min) / 3;
  return [min, min + step, min + 2 * step, max];
}

function formatDate(dStr: string) {
  const parts = dStr.split('.');
  if (parts.length === 3) return `${parts[1]}/${parts[2].slice(-2)}`;
  return dStr;
}

export function EloGraph({ points }: { points: any[] }) {
  if (!points?.length) return <div className="text-zinc-500 text-xs italic py-24 text-center border border-zinc-850 rounded-lg font-sans">No rating records found for this timeframe.</div>;
  const elos = points.map(p => p.elo);
  const min = Math.min(...elos) - 20;
  const max = Math.max(...elos) + 20;
  return <EloGraphContent points={points} min={min} max={max} />;
}

const EloGraphContent = ({ points, min, max }: any) => (
  <div className="space-y-4">
    <EloStatsHeader stats={computeRatingStats(points)} />
    <EloSvg points={points} min={min} max={max} />
  </div>
);

const EloStatsHeader = ({ stats }: any) => (
  <div className="grid grid-cols-4 gap-4 flex-grow font-sans">
    <div className="text-center sm:text-left">
      <div className="text-[10px] text-zinc-500 uppercase font-bold">Current</div>
      <div className="text-base font-bold font-mono text-zinc-200">{stats.current}</div>
    </div>
    <div className="text-center sm:text-left">
      <div className="text-[10px] text-zinc-500 uppercase font-bold">Peak</div>
      <div className="text-base font-bold font-mono text-emerald-400">{stats.peak}</div>
    </div>
    <div className="text-center sm:text-left">
      <div className="text-[10px] text-zinc-500 uppercase font-bold">Lowest</div>
      <div className="text-base font-bold font-mono text-rose-400">{stats.low}</div>
    </div>
    <div className="text-center sm:text-left">
      <div className="text-[10px] text-zinc-500 uppercase font-bold">Change</div>
      <div className={`text-base font-bold font-mono ${stats.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
        {stats.change >= 0 ? `+${stats.change}` : stats.change}
      </div>
    </div>
  </div>
);

function getEloPaths(points: any[], min: number, max: number) {
  const pts = points.map((p: any, i: number) => `${getX(i, points.length)},${getY(p.elo, min, max)}`).join(' L ');
  return {
    lineD: `M ${pts}`,
    areaD: `M ${getX(0, points.length)},220 L ${pts} L ${getX(points.length - 1, points.length)},220 Z`
  };
}

export function EloSvg({ points, min, max }: any) {
  const [hovered, setHovered] = useState<number | null>(null);
  const { lineD, areaD } = getEloPaths(points, min, max);
  const grid = getGridLines(min, max);
  return <EloChartContainer hovered={hovered} points={points} grid={grid} min={min} max={max} areaD={areaD} lineD={lineD} onHover={setHovered} />;
}

const EloChartContainer = ({ hovered, points, grid, min, max, areaD, lineD, onHover }: any) => (
  <div className="relative bg-zinc-900/20 border border-zinc-850 rounded-lg p-2">
    {hovered !== null && <EloTooltip point={points[hovered]} />}
    <svg viewBox="0 0 700 260" className="w-full h-auto">
      <defs><EloGradients /></defs>
      <EloGridLines grid={grid} min={min} max={max} />
      <path d={areaD} fill="url(#chartGrad)" opacity="0.1" />
      <path d={lineD} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinecap="round" />
      <EloDots points={points} min={min} max={max} onHover={onHover} />
    </svg>
  </div>
);

const EloGradients = () => (
  <>
    <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor="#3b82f6" />
      <stop offset="100%" stopColor="#10b981" />
    </linearGradient>
    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
    </linearGradient>
  </>
);

const EloGridLines = ({ grid, min, max }: any) => (
  <>
    {grid.map((val: number, i: number) => {
      const y = getY(val, min, max);
      return (
        <g key={i} className="opacity-20 font-mono text-[8px] fill-zinc-400">
          <line x1="50" y1={y} x2="680" y2={y} stroke="#52525b" strokeDasharray="3,3" />
          <text x="15" y={y + 3} textAnchor="start">{Math.round(val)}</text>
        </g>
      );
    })}
  </>
);

const EloDots = ({ points, min, max, onHover }: any) => (
  <>
    {points.map((p: any, i: number) => {
      const cx = getX(i, points.length);
      const cy = getY(p.elo, min, max);
      return (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r="3.5"
          className="fill-emerald-400 stroke-zinc-950 stroke-2 cursor-pointer hover:r-5 hover:fill-emerald-300 transition-all"
          onMouseEnter={() => onHover(i)}
          onMouseLeave={() => onHover(null)}
        />
      );
    })}
  </>
);

const EloTooltip = ({ point }: any) => (
  <div className="absolute top-4 right-4 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg shadow-lg text-xs font-sans text-zinc-300 pointer-events-none z-10">
    <span className="text-[9px] text-zinc-550 uppercase font-bold block">{point.date}</span>
    <span className="font-mono font-bold text-zinc-200">Rating: {point.elo}</span>
  </div>
);

function getPuzzleSuccessRate(pStats: any) {
  if (!pStats || !pStats.attempts) return '0';
  return ((pStats.completed / pStats.attempts) * 100).toFixed(0);
}

function getStatSummary(s: { wins: number; draws: number; losses: number }) {
  const total = s.wins + s.draws + s.losses;
  if (total === 0) return { total: 0, winPct: 0, drawPct: 0, lossPct: 0 };
  return {
    total,
    winPct: (s.wins / total) * 100,
    drawPct: (s.draws / total) * 100,
    lossPct: (s.losses / total) * 100
  };
}

export function OutcomeBar({ s }: any) {
  const summary = getStatSummary(s);
  return <OutcomeBarRender s={s} summary={summary} />;
}

const OutcomeBarRender = ({ s, summary }: any) => (
  summary.total === 0 ? (
    <div className="text-zinc-650 text-[11px] italic py-2 text-center font-sans">No games played.</div>
  ) : (
    <div className="space-y-1.5 font-sans">
      <div className="h-2.5 w-full rounded-full overflow-hidden flex bg-zinc-900 border border-zinc-850">
        {s.wins > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${summary.winPct}%` }} />}
        {s.draws > 0 && <div className="bg-zinc-500 h-full" style={{ width: `${summary.drawPct}%` }} />}
        {s.losses > 0 && <div className="bg-rose-500 h-full" style={{ width: `${summary.lossPct}%` }} />}
      </div>
      <div className="flex justify-between text-[9px] font-mono text-zinc-500">
        <span className="text-emerald-450 font-bold">{s.wins}W ({summary.winPct.toFixed(0)}%)</span>
        <span>{s.draws}D ({summary.drawPct.toFixed(0)}%)</span>
        <span className="text-rose-455 font-bold">{s.losses}L ({summary.lossPct.toFixed(0)}%)</span>
      </div>
    </div>
  )
);

export function OpeningsSection({ openings }: { openings: any[] }) {
  if (!openings || openings.length === 0) return <div className="text-zinc-550 text-xs italic py-6 text-center">No openings records.</div>;
  const maxCount = Math.max(...openings.map(o => o.count));
  return <OpeningsList openings={openings} max={maxCount} />;
}

const OpeningsList = ({ openings, max }: any) => (
  <div className="space-y-3 font-sans">
    {openings.map((op: any, idx: number) => (
      <div key={idx} className="space-y-1">
        <div className="flex justify-between text-xs text-zinc-300">
          <span className="truncate font-semibold text-zinc-200">{op.name}</span>
          <span className="font-mono text-zinc-500 text-[10px] font-bold bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-900 shrink-0">{op.count} games</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-900 rounded-full overflow-hidden border border-zinc-850">
          <div className="bg-gradient-to-r from-blue-600 to-indigo-500 h-full rounded-full" style={{ width: `${(op.count / max) * 100}%` }} />
        </div>
      </div>
    ))}
  </div>
);

function getOutcome(result: string, color: string) {
  if (result === '1/2-1/2') return 'draw';
  if ((result === '1-0' && color === 'w') || (result === '0-1' && color === 'b')) return 'win';
  return 'loss';
}

function addGameToStats(stats: any, outcome: string) {
  if (outcome === 'win') stats.wins++;
  else if (outcome === 'draw') stats.draws++;
  else stats.losses++;
  stats.total++;
}

function groupGamesByOpening(games: any[]) {
  const map = new Map<string, any>();
  for (const g of games) {
    const stats = map.get(g.name) || { wins: 0, draws: 0, losses: 0, total: 0, name: g.name };
    addGameToStats(stats, getOutcome(g.result, g.color));
    map.set(g.name, stats);
  }
  return Array.from(map.values());
}

function computeOpeningWinRates(grouped: any[]) {
  return grouped.map(g => ({
    ...g,
    winRate: g.total > 0 ? (g.wins / g.total) * 100 : 0
  })).sort((a, b) => b.winRate - a.winRate);
}

function getStrongestOpening(list: any[]) {
  const active = list.filter(o => o.total >= 2);
  if (!active.length) return null;
  const top = active[0];
  if (top.winRate < 50) return null;
  return {
    type: 'strong',
    title: 'Solid Choice',
    text: `Your ${top.name} is performing well with a ${top.winRate.toFixed(0)}% win rate. Keep utilizing it!`,
    icon: '🏆'
  };
}

function getWeakestOpening(list: any[]) {
  const active = list.filter(o => o.total >= 2);
  if (!active.length) return null;
  const bottom = [...active].sort((a, b) => a.winRate - b.winRate)[0];
  if (bottom.winRate >= 50) return null;
  return {
    type: 'improve',
    title: 'Needs Work',
    text: `Your ${bottom.name} has a lower win rate of ${bottom.winRate.toFixed(0)}%. Consider reviewing common mistakes or practicing its book lines.`,
    icon: '⚠️'
  };
}

function generateSuggestions(list: any[]) {
  const suggs = [];
  const strong = getStrongestOpening(list);
  if (strong) suggs.push(strong);
  const weak = getWeakestOpening(list);
  if (weak) suggs.push(weak);
  return suggs;
}

const DashboardSuggestions = ({ suggestions }: any) => (
  suggestions.length > 0 && (
    <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4">
      <h2 className="text-xs font-bold text-zinc-405 uppercase tracking-wider font-sans">Strategic Recommendations</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {suggestions.map((s: any, i: number) => (
          <div key={i} className={`p-4 rounded-xl border flex gap-3 items-start ${
            s.type === 'strong' 
              ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-300' 
              : 'bg-amber-950/20 border-amber-900/30 text-amber-300'
          }`}>
            <span className="text-xl shrink-0 mt-0.5">{s.icon}</span>
            <div className="space-y-1">
              <div className="text-xs font-bold font-sans uppercase tracking-wider">{s.title}</div>
              <div className="text-[11px] leading-relaxed text-zinc-400">{s.text}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
);

const OpeningsPerformanceStats = ({ openings }: any) => (
  <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4 font-sans">
    <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Opening Performance</h2>
    <div className="space-y-3 divide-y divide-zinc-900/40 max-h-60 overflow-y-auto pr-1">
      {openings.map((op: any, i: number) => (
        <div key={i} className="pt-3 first:pt-0 space-y-1">
          <div className="flex justify-between text-xs text-zinc-200">
            <span className="font-semibold truncate">{op.name}</span>
            <span className="font-mono text-zinc-400 font-bold">{op.winRate.toFixed(0)}% win rate</span>
          </div>
          <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono">
            <span>{op.total} games played</span>
            <span>{op.wins}W / {op.draws}D / {op.losses}L</span>
          </div>
        </div>
      ))}
    </div>
  </div>
);
