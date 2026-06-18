'use client';

import React, { useEffect, useState } from 'react';

export interface DbMoveStat {
  uci: string;
  san: string;
  wins: number;
  draws: number;
  losses: number;
}

type Props = {
  fen: string;
  onSelectMove: (uci: string) => void;
};

function fetchExplorerStats(fen: string, cb: (m: any) => void): () => void {
  const controller = new AbortController();
  const t = setTimeout(() => {
    fetch(`/api/explorer?fen=${encodeURIComponent(fen)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { moves: [] }))
      .then((data) => cb(data.moves || []))
      .catch((err) => err.name !== 'AbortError' && cb([]));
  }, 200);
  return () => { clearTimeout(t); controller.abort(); };
}

function useExplorerStats(fen: string) {
  const [stats, setStats] = useState<DbMoveStat[]>([]);
  useEffect(() => {
    if (!fen) return;
    return fetchExplorerStats(fen, setStats);
  }, [fen]);
  return stats;
}


const RatioBar = ({ wins, draws, losses, total }: any) => {
  const w = (wins / total) * 100, d = (draws / total) * 100, l = (losses / total) * 100;
  return (
    <div className="h-1.5 rounded-full overflow-hidden flex bg-zinc-800 mt-1">
      <div className="bg-emerald-600 h-full" style={{ width: `${w}%` }} title={`Wins: ${wins}`} />
      <div className="bg-zinc-500 h-full" style={{ width: `${d}%` }} title={`Draws: ${draws}`} />
      <div className="bg-rose-600 h-full" style={{ width: `${l}%` }} title={`Losses: ${losses}`} />
    </div>
  );
};

const MoveHeader = ({ stat, total, onSelectMove }: any) => (
  <div className="flex justify-between items-baseline">
    <button onClick={() => onSelectMove(stat.uci)} className="font-mono font-bold text-blue-400 hover:underline cursor-pointer">{stat.san}</button>
    <span className="text-zinc-400 font-semibold">{((stat.wins / total) * 100).toFixed(0)}% win</span>
    <span className="text-zinc-500 tabular-nums">{total} games</span>
  </div>
);

const MoveRow = ({ stat, onSelectMove }: any) => {
  const total = stat.wins + stat.draws + stat.losses;
  return (
    <div className="py-1.5 border-b border-zinc-800 last:border-0 text-xs">
      <MoveHeader stat={stat} total={total} onSelectMove={onSelectMove} />
      <RatioBar wins={stat.wins} draws={stat.draws} losses={stat.losses} total={total} />
    </div>
  );
};

const EmptyDbState = () => <div className="px-3 py-2 text-zinc-500 text-xs italic">No personal games in database.</div>;

export function DbExplorer({ fen, onSelectMove }: Props) {
  const stats = useExplorerStats(fen);
  if (stats.length === 0) return <EmptyDbState />;
  return (
    <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
      <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">My Explorer</p>
      <div className="max-h-40 overflow-y-auto pr-1">{stats.slice(0, 5).map((s) => <MoveRow key={s.uci} stat={s} onSelectMove={onSelectMove} />)}</div>
    </div>
  );
}
