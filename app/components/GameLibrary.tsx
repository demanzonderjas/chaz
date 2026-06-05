'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onSelectGame: (pgn: string, id?: number) => void;
}

async function handleGameClick(id: number, onSelect: (pgn: string, id?: number) => void, onClose: () => void) {
  const res = await fetch(`/api/games?id=${id}`);
  if (res.ok) {
    const data = await res.json();
    onSelect(data.pgn, id);
    onClose();
  }
}

function useGamesList(isOpen: boolean, selectedOpening: string) {
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const refresh = useCallback(async () => {
    setLoading(true);
    let url = '/api/games';
    if (selectedOpening !== 'all') {
      const [opId, color] = selectedOpening.split('_');
      url += `?openingId=${opId}&color=${color}`;
    }
    try {
      const r = await fetch(url);
      const d = await r.json();
      setGames(d.games || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedOpening]);

  useEffect(() => {
    if (isOpen) refresh();
  }, [isOpen, refresh]);

  return { games, loading, refresh };
}

function getOutcome(res: string, color: string) {
  if (res === '1/2-1/2') return 'draw';
  if ((res === '1-0' && color === 'w') || (res === '0-1' && color === 'b')) return 'win';
  return 'loss';
}

function getOutcomeStyles(outcome: string) {
  if (outcome === 'win') return 'bg-emerald-950/60 text-emerald-400 border border-emerald-800';
  if (outcome === 'loss') return 'bg-rose-950/60 text-rose-400 border border-rose-800';
  return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
}

const GameHeader = ({ date, moves, onDelete }: any) => (
  <div className="flex justify-between text-[11px] text-zinc-500 mb-1 items-center">
    <span>{date}</span>
    <div className="flex items-center gap-2">
      <span className="font-semibold">{moves} moves</span>
      <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="text-zinc-500 hover:text-rose-450 hover:scale-105 active:scale-95 transition-all p-0.5 cursor-pointer text-xs" title="Delete game">🗑️</button>
    </div>
  </div>
);

const GameTags = ({ outcome, result, outcomeStyles, color }: any) => (
  <div className="flex gap-2 mt-2">
    <span className={`text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider font-bold ${outcomeStyles}`}>
      {outcome} ({result})
    </span>
    <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 font-medium">
      As {color === 'w' ? 'White' : 'Black'}
    </span>
  </div>
);

const GameCard = ({ game, onClick, onDelete }: any) => {
  const outcome = getOutcome(game.result, game.user_color);
  return (
    <div onClick={onClick} className="p-3 mb-2 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/80 cursor-pointer transition-all">
      <GameHeader date={game.played_date} moves={game.move_count} onDelete={onDelete} />
      <div className="text-sm font-semibold text-zinc-200 truncate pr-6">{game.white_name} vs {game.black_name}</div>
      <GameTags outcome={outcome} result={game.result} outcomeStyles={getOutcomeStyles(outcome)} color={game.user_color} />
    </div>
  );
};

const DrawerHeader = ({ onClose }: any) => (
  <div className="p-4 border-b border-zinc-800 flex justify-between items-center">
    <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">📚 Game Library</h2>
    <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 cursor-pointer text-2xl font-light select-none">×</button>
  </div>
);

const DrawerBody = ({ loading, games, onSelectGame, onClose, onDelete }: any) => (
  <div className="flex-1 overflow-y-auto p-4">
    {loading ? <div className="text-center text-xs text-zinc-500 py-8">Loading games...</div> :
      games.map((g: any) => <GameCard key={g.id} game={g} onClick={() => handleGameClick(g.id, onSelectGame, onClose)} onDelete={() => onDelete(g.id)} />)}
  </div>
);

const DrawerPanel = ({ isOpen, onClose, children }: any) => (
  <div className={`fixed inset-0 z-40 ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}>
    <div onClick={onClose} className={`absolute inset-0 bg-black/60 transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`} />
    <div className={`absolute top-0 left-0 bottom-0 w-80 bg-zinc-950 border-r border-zinc-800 z-50 transform transition-transform duration-300 flex flex-col ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
      <DrawerHeader onClose={onClose} />
      {children}
    </div>
  </div>
);

export function GameLibrary({ isOpen, onClose, onSelectGame }: Props) {
  const [selectedOpening, setSelectedOpening] = useState<string>('all');
  const [openings, setOpenings] = useState<any[]>([]);

  useEffect(() => {
    if (isOpen) {
      fetch('/api/openings')
        .then(res => res.json())
        .then(data => {
          if (data.openings) setOpenings(data.openings);
        })
        .catch(err => console.error('Error fetching openings:', err));
    }
  }, [isOpen]);

  const { games, loading, refresh } = useGamesList(isOpen, selectedOpening);

  const del = useCallback(async (id: number) => {
    if ((await fetch(`/api/games?id=${id}`, { method: 'DELETE' })).ok) refresh();
  }, [refresh]);

  return (
    <DrawerPanel isOpen={isOpen} onClose={onClose}>
      <div className="px-4 py-3 border-b border-zinc-900 bg-zinc-950 flex flex-col gap-1.5 shrink-0">
        <label className="block text-[10px] uppercase font-bold tracking-wider text-zinc-500">
          Filter by Opening
        </label>
        <select
          value={selectedOpening}
          onChange={(e) => setSelectedOpening(e.target.value)}
          className="w-full bg-zinc-900 border border-zinc-800 rounded py-1.5 px-2 text-xs text-zinc-350 font-semibold focus:outline-none focus:border-zinc-700 cursor-pointer transition-colors"
        >
          <option value="all">All Openings</option>
          {openings.map((op) => (
            <option key={`${op.id}_${op.color}`} value={`${op.id}_${op.color}`}>
              {op.name} ({op.color === 'w' ? 'White' : 'Black'})
            </option>
          ))}
        </select>
      </div>
      <DrawerBody loading={loading} games={games} onSelectGame={onSelectGame} onClose={onClose} onDelete={del} />
    </DrawerPanel>
  );
}
