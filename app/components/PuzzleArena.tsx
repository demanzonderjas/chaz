'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, ChessboardProvider } from 'react-chessboard';
import { playMoveSound, playErrorSound } from '../services/sound';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function normalizeBookFen(fen: string): string {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

function getSquareCoords(square: string, orientation: 'white' | 'black') {
  const colIndex = square.charCodeAt(0) - 97;
  const rowIndex = parseInt(square[1]) - 1;
  const x = orientation === 'white' ? (colIndex + 0.5) * 12.5 : (7 - colIndex + 0.5) * 12.5;
  const y = orientation === 'white' ? (7 - rowIndex + 0.5) * 12.5 : (rowIndex + 0.5) * 12.5;
  return { x, y };
}

function getArrowPathData(fromSq: string, toSq: string, orientation: 'white' | 'black') {
  const f = getSquareCoords(fromSq, orientation), t = getSquareCoords(toSq, orientation);
  const dx = t.x - f.x, dy = t.y - f.y, isK = Math.abs(Math.round(dx / 12.5) * Math.round(dy / 12.5)) === 2;
  const c = isK ? (Math.abs(dx) < Math.abs(dy) ? { x: f.x, y: t.y } : { x: t.x, y: f.y }) : null;
  const sx = c ? c.x : f.x, sy = c ? c.y : f.y, theta = Math.atan2(t.y - sy, t.x - sx);
  const bx = t.x - 5.0 * Math.cos(theta), by = t.y - 5.0 * Math.sin(theta);
  const pathD = c ? `M ${f.x} ${f.y} L ${c.x} ${c.y} L ${bx} ${by}` : `M ${f.x} ${f.y} L ${bx} ${by}`;
  return { pathD, theta, bx, by, tx: t.x, ty: t.y };
}

function getArrowheadPoints(bx: number, by: number, tx: number, ty: number, theta: number) {
  const w = 5.0;
  const lx = bx + (w / 2) * Math.cos(theta + Math.PI / 2);
  const ly = by + (w / 2) * Math.sin(theta + Math.PI / 2);
  const rx = bx + (w / 2) * Math.cos(theta - Math.PI / 2);
  const ry = by + (w / 2) * Math.sin(theta - Math.PI / 2);
  return `${tx},${ty} ${lx},${ly} ${rx},${ry}`;
}

const BlunderArrow = ({ from, to, orientation }: { from: string; to: string; orientation: 'white' | 'black' }) => {
  const d = getArrowPathData(from, to, orientation), p = getArrowheadPoints(d.bx, d.by, d.tx, d.ty, d.theta);
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 pointer-events-none z-20" style={{ opacity: 0.65 }}>
      <path d={d.pathD} fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" />
      <polygon points={p} fill="#dc2626" />
    </svg>
  );
};

interface Puzzle {
  id: number;
  game_id: number;
  start_fen: string;
  solution_uci: string;
  solution_san: string;
  player_color: string;
  description: string;
  blunder_uci: string;
  blunder_san: string;
  game_title: string;
}

function getEvalLabel(ev: any): string {
  if (!ev) return '';
  if (ev.mate !== undefined && ev.mate !== null) return ev.mate === 0 ? '#' : `M${Math.abs(ev.mate)}`;
  const cpVal = ev.cp ?? ev.score;
  if (cpVal === undefined || cpVal === null) return '';
  const val = cpVal / 100;
  return (val >= 0 ? '+' : '') + val.toFixed(2);
}

function isAcceptableMove(uci: string, puzzle: any, ev: any): boolean {
  if (puzzle?.type === 'weakness' && uci === puzzle.blunder_uci) {
    return false;
  }
  if (puzzle?.type === 'book') {
    return puzzle.valid_moves ? puzzle.valid_moves.includes(uci) : uci === puzzle.solution_uci;
  }
  if (uci === puzzle.solution_uci) return true;
  const lines = ev?.candidates || ev?.lines;
  const best = lines?.[0], cand = lines?.find((l: any) => l.pv?.[0] === uci);
  if (!best || !cand) return false;
  if (best.mate !== null && best.mate !== undefined) {
    return cand.mate !== null && cand.mate !== undefined;
  }
  const diff = (best.score ?? best.cp ?? 0) - (cand.score ?? cand.cp ?? 0);
  return diff <= 50;
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

const CandidateItem = ({ line, startFen, idx }: any) => {
  const cpVal = line.score ?? line.cp ?? 0;
  const score = line.mate !== null && line.mate !== undefined ? (line.mate === 0 ? '#' : `M${Math.abs(line.mate)}`) : `${(cpVal / 100).toFixed(2)}`;
  return (
    <div className="flex justify-between text-zinc-300 font-mono text-xs">
      <span>{idx + 1}. {getSan(startFen, line.pv[0])}</span>
      <span className="text-zinc-400">{score}</span>
    </div>
  );
};

const CandidateMovesList = ({ evaluation, startFen }: { evaluation: any; startFen: string }) => {
  const lines = evaluation?.candidates || evaluation?.lines;
  if (!lines) return null;
  return (
    <div className="mt-4 p-3 bg-zinc-900 border border-zinc-850 rounded-lg">
      <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-2">Candidate Moves</div>
      <div className="space-y-1">{lines.slice(0, 4).map((l: any, i: number) => <CandidateItem key={i} line={l} startFen={startFen} idx={i} />)}</div>
    </div>
  );
};

const BookLinesList = ({ 
  bookLines, 
  boardFen, 
  setBoardFen, 
  activeLineIdx,
  setActiveLineIdx,
  activeMoveIdx
}: { 
  bookLines: any[]; 
  boardFen: string; 
  setBoardFen: (fen: string) => void; 
  activeLineIdx: number;
  setActiveLineIdx: (idx: number) => void;
  activeMoveIdx: number;
}) => {
  if (!bookLines || bookLines.length === 0) return null;
  return (
    <div className="mt-4 p-3 bg-zinc-900 border border-zinc-850 rounded-lg space-y-3">
      <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Book Lines Explorer</div>
      {bookLines.map((line, lineIdx) => {
        const isLineActive = activeLineIdx === lineIdx;
        return (
          <div key={lineIdx} className="space-y-1.5 border-b border-zinc-850/60 last:border-0 pb-2.5 last:pb-0">
            <div className={`text-[10px] font-semibold truncate transition-colors ${isLineActive ? 'text-blue-300 font-bold' : 'text-zinc-500 font-medium'}`} title={line.name}>
              📖 {line.name} {isLineActive && <span className="text-[9px] px-1 py-0.2 rounded bg-blue-950/80 border border-blue-900 text-blue-400 font-bold ml-1 uppercase tracking-wider">Active</span>}
            </div>
            <div className="flex flex-wrap gap-1">
              <button 
                onClick={() => {
                  playMoveSound(false);
                  setActiveLineIdx(lineIdx);
                  setBoardFen(line.start_fen || STARTING_FEN);
                }}
                className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${isLineActive && activeMoveIdx === -1 ? 'bg-zinc-850 border-zinc-700 text-zinc-100 font-bold' : 'bg-zinc-950 border-zinc-900 text-zinc-500 hover:text-zinc-355'}`}
              >
                Start
              </button>
              {line.moves.map((move: any, moveIdx: number) => {
                const isCurrentMove = isLineActive && activeMoveIdx === moveIdx;
                return (
                  <button
                    key={moveIdx}
                    onClick={() => {
                      playMoveSound(move.san.includes('x'));
                      setActiveLineIdx(lineIdx);
                      setBoardFen(move.fen_after);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${isCurrentMove ? 'bg-blue-900/60 border-blue-700 text-blue-100 font-bold' : 'bg-zinc-950 border-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                  >
                    {move.san}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};

function getPromoPiece(pieceType: string, targetSquare: string): string | undefined {
  const isPawn = pieceType.toLowerCase().endsWith('p');
  const isPromoRank = targetSquare[1] === '8' || targetSquare[1] === '1';
  return isPawn && isPromoRank ? 'q' : undefined;
}

function isLegalMove(fen: string, from: string, to: string, promo?: string): boolean {
  try {
    const chess = new Chess(fen);
    return chess.move({ from, to, promotion: promo }) !== null;
  } catch {
    return false;
  }
}

function moveSafe(chess: Chess, m: string) {
  try {
    const r = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    return { san: r.san, fen: chess.fen() };
  } catch { return null; }
}

function getBestLineMoves(puzzle: any, evaluation: any): { san: string; fen: string }[] {
  const pv = evaluation?.pv || evaluation?.candidates?.[0]?.pv || evaluation?.lines?.[0]?.pv || [];
  if (!pv.length || !puzzle?.start_fen) return [];
  const chess = new Chess(puzzle.start_fen);
  return pv.slice(0, 14).map((m: string) => moveSafe(chess, m)).filter(Boolean) as any;
}

const BestLineViewer = ({ 
  moves, 
  boardFen, 
  setBoardFen, 
  startFen 
}: { 
  moves: any[]; 
  boardFen: string; 
  setBoardFen: (fen: string) => void; 
  startFen: string;
}) =>
  !moves?.length ? null : (
    <div className="mt-4 p-3 bg-zinc-900 border border-zinc-850 rounded-lg space-y-2">
      <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Best Line Explorer</div>
      <div className="flex flex-wrap gap-1 items-center">
        <button 
          onClick={() => {
            playMoveSound(false);
            setBoardFen(startFen);
          }} 
          className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${boardFen === startFen ? 'bg-emerald-800 border-emerald-600 text-white' : 'bg-emerald-950 border-emerald-900 text-emerald-405 hover:text-emerald-350'}`}
        >
          Start
        </button>
        {moves.map((m: any, i: number) => (
          <button 
            key={i} 
            onClick={() => {
              playMoveSound(m.san.includes('x'));
              setBoardFen(m.fen);
            }} 
            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${boardFen === m.fen ? 'bg-emerald-800 border-emerald-600 text-white' : 'bg-zinc-950 border-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
          >
            {m.san}
          </button>
        ))}
      </div>
    </div>
  );

const StatusCard = ({ 
  status, 
  solution, 
  puzzleType, 
  hint,
  isSequence
}: { 
  status: string; 
  solution: string; 
  puzzleType: string; 
  hint: string | null;
  isSequence?: boolean;
}) => {
  if (status === 'correct') {
    return (
      <div className="p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-400 rounded text-sm font-semibold text-center shadow-lg">
        {puzzleType === 'book' 
          ? (isSequence ? '✨ CORRECT! You completed the book sequence.' : '✨ CORRECT! You found the book move.')
          : '✨ CORRECT! You found the best move.'}
      </div>
    );
  }
  if (status === 'incorrect') {
    return (
      <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-400 rounded text-sm font-semibold text-center shadow-lg flex flex-col gap-1">
        <span>❌ INCORRECT! That is a mistake.</span>
        {hint && <span className="text-xs text-rose-300 font-light mt-0.5">{hint}</span>}
      </div>
    );
  }
  if (status === 'solved') return <div className="p-3 bg-blue-950/60 border border-blue-800 text-blue-400 rounded text-sm font-semibold text-center shadow-lg">💡 Solution: {solution}</div>;
  return <div className="p-3 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded text-sm text-center">Make your move on the board...</div>;
};

const ZwischenzugExplanation = ({ evaluation, puzzle }: { evaluation: any; puzzle: any }) => {
  if (!evaluation || !puzzle) return null;
  const candSolution = evaluation.candidates?.find((c: any) => c.bestMove === puzzle.solution_uci);
  const candBlunder = evaluation.candidates?.find((c: any) => c.bestMove === puzzle.blunder_uci);
  
  const getScoreLabel = (cand: any) => {
    if (!cand) return 'much worse';
    if (cand.mate !== undefined && cand.mate !== null) return cand.mate === 0 ? '#' : `M${Math.abs(cand.mate)}`;
    const val = cand.cp ?? cand.score ?? 0;
    return `${(val / 100).toFixed(2)}`;
  };

  const solScore = getScoreLabel(candSolution);
  const blunderScore = getScoreLabel(candBlunder);

  return (
    <div className="mt-4 p-3 bg-zinc-900 border border-zinc-850 rounded-lg space-y-2">
      <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Zwischenzug Analysis</div>
      <div className="text-xs text-zinc-300 leading-relaxed">
        Instead of playing the natural move <strong className="text-rose-400">{puzzle.blunder_san}</strong> (Eval: <span className="font-mono">{blunderScore}</span>), the best move is the intermediate threat <strong className="text-emerald-400">{puzzle.solution_san}</strong> (Eval: <span className="font-mono">{solScore}</span>).
      </div>
    </div>
  );
};

function getScore(ev: any): number | null {
  if (!ev) return null;
  const best = ev.candidates?.[0] ?? ev;
  if (best.bestMove === '(none)' || best.bestMove === null) {
    return -10000; // Side to move has no moves (checkmated)
  }
  if (best.mate !== undefined && best.mate !== null) return best.mate > 0 ? 10000 : -10000;
  return best.cp ?? best.score ?? 0;
}

function getScoreLabel(score: number | null): string {
  if (score === null) return 'unknown';
  if (Math.abs(score) >= 9000) return score > 0 ? 'Mate' : '-Mate';
  return (score > 0 ? '+' : '') + (score / 100).toFixed(2);
}

function getDiffText(puzzle: any, bestScore: number, blunderScore: number | null): string {
  let bestLabel = getScoreLabel(bestScore);
  let blunderLabel = getScoreLabel(blunderScore);

  if (puzzle.blunder_san?.endsWith('#')) {
    blunderLabel = 'Mate';
  }
  if (puzzle.solution_san?.endsWith('#')) {
    bestLabel = 'Mate';
  }

  const isBestMate = (bestScore !== null && Math.abs(bestScore) >= 9000) || puzzle.solution_san?.endsWith('#');
  const isBlunderMate = (blunderScore !== null && Math.abs(blunderScore) >= 9000) || puzzle.blunder_san?.endsWith('#');

  const diff = blunderScore !== null && !isBestMate && !isBlunderMate
    ? `${((bestScore - blunderScore) / 100).toFixed(2)} pawns` : null;

  return `Instead of playing ${puzzle.blunder_san} (${blunderLabel}), the best move was ${puzzle.solution_san} (${bestLabel}).` + (diff ? ` This dropped the evaluation by ${diff}.` : '');
}

function getExplanationTitle(type: string): string {
  if (type === 'defensive') return 'Defensive Analysis';
  if (type === 'endgame') return 'Endgame Analysis';
  if (type === 'opening') return 'Opening Analysis';
  return 'Conversion Analysis';
}

const BlunderDiffExplanation = ({ evaluation, blunderEvaluation, puzzle, type }: { evaluation: any; blunderEvaluation: any; puzzle: any; type: string }) => {
  const bestScore = getScore(evaluation);
  const blunderVal = blunderEvaluation ? getScore(blunderEvaluation) : null;
  const blunderScore = blunderVal !== null ? -blunderVal : null;
  if (bestScore === null || !puzzle) return null;
  return <div className="mt-4 p-3 bg-zinc-900 border border-zinc-850 rounded-lg space-y-2 font-sans">
    <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">{getExplanationTitle(type)}</div>
    <div className="text-xs text-zinc-300 leading-relaxed">{getDiffText(puzzle, bestScore, blunderScore)}</div>
  </div>;
};

const PuzzlePrompt = ({ 
  desc, 
  title, 
  evaluation, 
  bookLine, 
  onLoadGame 
}: { 
  desc: string; 
  title: string; 
  evaluation: any; 
  bookLine: string | null;
  onLoadGame?: () => void;
}) => (
  <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg shadow-md mb-4">
    <div className="flex justify-between items-start mb-1.5">
      <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Challenge</span>
      {evaluation && (
        <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">
          Eval: {getEvalLabel(evaluation)}
        </span>
      )}
    </div>
    <div className="text-sm font-bold text-zinc-100 mb-3 leading-relaxed">{desc}</div>
    {bookLine && (
      <div className="mb-3">
        <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Opening Book Line</div>
        <div className="text-xs text-blue-300 font-semibold truncate flex items-center gap-1">📖 {bookLine}</div>
      </div>
    )}
    <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1">Source Game</div>
    {onLoadGame ? (
      <button 
        onClick={onLoadGame} 
        className="text-xs text-blue-400 hover:text-blue-300 hover:underline font-semibold truncate flex items-center gap-1 cursor-pointer w-full text-left"
        title="Load this game and analyze from this position"
      >
        🔗 {title}
      </button>
    ) : (
      <div className="text-xs text-zinc-300 font-medium truncate">{title}</div>
    )}
  </div>
);

const PuzzleControls = ({ status, onNext, onReveal, onExit }: any) => (
  <div className="flex flex-col gap-2 mt-4">
    <button onClick={onNext} className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold transition-all cursor-pointer shadow-md shadow-emerald-950/20">Next Puzzle</button>
    <button onClick={onReveal} disabled={status === 'solved' || status === 'correct'} className="w-full py-2 bg-zinc-850 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 rounded text-sm font-semibold transition-all border border-zinc-700 cursor-pointer">Show Solution</button>
    <button onClick={onExit} className="w-full py-2 bg-zinc-950 hover:bg-zinc-900 text-zinc-400 rounded text-sm font-semibold transition-all border border-zinc-850 cursor-pointer mt-4">Back to Analysis</button>
  </div>
);

function checkUciMove(uci: string, puzzle: any) {
  return uci === puzzle.solution_uci;
}

function applyCorrectMove(src: string, dst: string, promo: string | undefined, boardFen: string, setBoardFen: any, setStatus: any) {
  const chess = new Chess(boardFen);
  chess.move({ from: src, to: dst, promotion: promo });
  setBoardFen(chess.fen());
  setStatus('correct');
}

function handleWrongMove(puzzle: any, setBoardFen: any, setStatus: any) {
  setStatus('incorrect');
  setTimeout(() => {
    setBoardFen(puzzle.start_fen);
    setStatus('playing');
  }, 1000);
}

const BlunderBadge = () => (
  <div className="absolute top-[3px] right-[3px] z-20 flex pointer-events-none">
    <span className="flex items-center justify-center rounded-full border-[2.5px] border-white shadow-[0_2px_4px_rgba(0,0,0,0.4)] font-bold leading-none w-8 h-8 text-sm bg-[#dc2626] text-white">??</span>
  </div>
);

type PuzzleType = 'tactical' | 'zwischenzug' | 'book' | 'weakness' | 'opening' | 'winning_position' | 'endgame' | 'defensive';

const PUZZLE_TYPES = [
  { id: 'tactical', label: 'Tactical' },
  { id: 'zwischenzug', label: 'Zwischenzug' },
  { id: 'book', label: 'Book' },
  { id: 'weakness', label: 'Weakness' },
  { id: 'opening', label: 'Opening' },
  { id: 'winning_position', label: 'Winning' },
  { id: 'endgame', label: 'Endgame' },
  { id: 'defensive', label: 'Defensive' },
] as const;

export function PuzzleArena({ onExit, onLoadGame }: { onExit: () => void; onLoadGame?: (pgn: string, startFen: string, gameId: number) => void }) {
  const [puzzleType, setPuzzleType] = useState<PuzzleType>('winning_position');
  const [puzzle, setPuzzle] = useState<any>(null);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [blunderEvaluation, setBlunderEvaluation] = useState<any>(null);
  const [bookLine, setBookLine] = useState<string | null>(null);
  const [boardFen, setBoardFen] = useState(STARTING_FEN);
  const [status, setStatus] = useState<'playing' | 'correct' | 'incorrect' | 'loading' | 'solved' | 'error'>('loading');
  const [hint, setHint] = useState<string | null>(null);
  const [hasMadeMistake, setHasMadeMistake] = useState(false);
  const [attemptReported, setAttemptReported] = useState(false);
  const [openings, setOpenings] = useState<{ id: number; name: string; color: string; game_count: number }[]>([]);
  const [selectedOpening, setSelectedOpening] = useState<string>('all');
  const [selectedRecency, setSelectedRecency] = useState<string>('7');

  const [fetchKey, setFetchKey] = useState(0);

  useEffect(() => {
    fetch('/api/openings')
      .then(res => res.json())
      .then(data => {
        if (data.openings) {
          setOpenings(data.openings);
        }
      })
      .catch(err => console.error('Error fetching openings:', err));
  }, []);

  const loadNext = useCallback(() => {
    setFetchKey(k => k + 1);
  }, []);

  const reportAttempt = useCallback((success: boolean) => {
    if (!puzzle || attemptReported) return;
    setAttemptReported(true);
    fetch('/api/puzzles/attempt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        puzzleId: puzzle.id,
        startFen: puzzle.start_fen,
        success
      })
    }).catch(err => console.error('Error reporting puzzle attempt:', err));
  }, [puzzle, attemptReported]);

  useEffect(() => {
    let active = true;
    setStatus('loading');
    setHint(null);
    setHasMadeMistake(false);
    setAttemptReported(false);
    
    let url = `/api/puzzles?type=${puzzleType}`;
    if (selectedOpening !== 'all') {
      const [opId, color] = selectedOpening.split('_');
      url += `&openingId=${opId}&color=${color}`;
    }
    if (selectedRecency !== 'all') {
      url += `&days=${selectedRecency}`;
    }

    fetch(url)
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch puzzle');
        return res.json();
      })
      .then(data => {
        if (!active) return;
        setPuzzle(data.puzzle);
        setEvaluation(data.evaluation);
        setBlunderEvaluation(data.blunderEvaluation || null);
        setBookLine(data.bookLine || null);
        setBoardFen(data.puzzle.start_fen);
        setStatus('playing');
        setActiveLineIdx(0);
        
        // Initialize sequenceMoveIdx for book puzzles
        const lines = data.puzzle?.book_lines || [];
        if (data.puzzle?.type === 'book' && lines.length > 0) {
          const startIdx = lines[0].moves.findIndex(
            (m: any) => normalizeBookFen(m.fen_before) === normalizeBookFen(data.puzzle.start_fen)
          );
          setSequenceMoveIdx(startIdx !== -1 ? startIdx : 0);
        } else {
          setSequenceMoveIdx(-1);
        }

        setHint(null);
        setHasMadeMistake(false);
        setAttemptReported(false);
      })
      .catch(() => {
        if (active) setStatus('error');
      });

    return () => {
      active = false;
    };
  }, [puzzleType, fetchKey, selectedOpening, selectedRecency]);

  const [activeLineIdx, setActiveLineIdx] = useState<number>(0);
  const [sequenceMoveIdx, setSequenceMoveIdx] = useState<number>(-1);
  
  const activeLine = puzzle?.book_lines?.[activeLineIdx];
  const activeMoveIdx = (() => {
    if (!activeLine) return -2;
    const normBoard = normalizeBookFen(boardFen);
    if (normBoard === normalizeBookFen(activeLine.start_fen || STARTING_FEN)) {
      return -1;
    }
    const moves = activeLine.moves || [];
    for (let i = 0; i < moves.length; i++) {
      if (normalizeBookFen(moves[i].fen_after) === normBoard) {
        return i;
      }
    }
    return -2;
  })();

  useEffect(() => {
    if (status !== 'correct' && status !== 'solved') return;
    if (puzzleType !== 'book' || !puzzle?.book_lines || puzzle.book_lines.length === 0) return;

    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      
      const activeLine = puzzle.book_lines[activeLineIdx];
      if (!activeLine) return;

      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (activeMoveIdx > -1) {
          const nextIdx = activeMoveIdx - 1;
          const nextFen = nextIdx === -1 ? (activeLine.start_fen || STARTING_FEN) : activeLine.moves[nextIdx].fen_after;
          playMoveSound(false);
          setBoardFen(nextFen);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (activeMoveIdx < activeLine.moves.length - 1) {
          const nextIdx = activeMoveIdx + 1;
          const nextMove = activeLine.moves[nextIdx];
          playMoveSound(nextMove.san.includes('x'));
          setBoardFen(nextMove.fen_after);
        }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, puzzleType, puzzle, activeLineIdx, activeMoveIdx, activeLine, setBoardFen]);

  // Keyboard navigation for tactical (non-book) best line
  useEffect(() => {
    if (status !== 'correct' && status !== 'solved') return;
    if (puzzleType === 'book') return;
    const moves = getBestLineMoves(puzzle, evaluation);
    if (!moves.length) return;

    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();

      const idx = moves.findIndex((m) => m.fen === boardFen);
      const isR = e.key === 'ArrowRight';

      if (isR && idx < moves.length - 1) {
        setBoardFen(moves[idx + 1].fen);
        playMoveSound(moves[idx + 1].san.includes('x'));
      } else if (!isR) {
        setBoardFen(idx > 0 ? moves[idx - 1].fen : puzzle.start_fen);
        playMoveSound(false);
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, puzzleType, puzzle, evaluation, boardFen, setBoardFen]);

  // Opponent Auto-play logic (Computer moves in sequence)
  useEffect(() => {
    if (puzzleType !== 'book' || !puzzle || !activeLine || status !== 'playing') return;

    if (sequenceMoveIdx >= activeLine.moves.length) {
      // Sequence completed!
      setStatus('correct');
      reportAttempt(!hasMadeMistake);
      return;
    }

    if (sequenceMoveIdx < 0) return;

    const currentMove = activeLine.moves[sequenceMoveIdx];
    const isPlayerWhite = puzzle.player_color === 'w';
    const isCurrentMoveWhite = currentMove.ply % 2 === 1;
    const isComputerTurn = (isPlayerWhite && !isCurrentMoveWhite) || (!isPlayerWhite && isCurrentMoveWhite);

    if (isComputerTurn) {
      const timer = setTimeout(() => {
        setBoardFen(currentMove.fen_after);
        setSequenceMoveIdx(prev => prev + 1);
        playMoveSound(currentMove.san.includes('x'));
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [puzzleType, puzzle, activeLine, sequenceMoveIdx, status, reportAttempt, hasMadeMistake]);

  const bestLineMoves = getBestLineMoves(puzzle, evaluation);

  const handleTypeChange = (type: PuzzleType) => {
    setPuzzleType(type);
    setPuzzle(null); setEvaluation(null); setBlunderEvaluation(null); setBookLine(null);
    setBoardFen(STARTING_FEN); setActiveLineIdx(0); setSequenceMoveIdx(-1);
    setHint(null); setHasMadeMistake(false); setAttemptReported(false);
  };

  const onReveal = useCallback(() => {
    if (!puzzle) return;
    reportAttempt(false);
    setHasMadeMistake(true);
    
    if (puzzleType === 'book') {
      const activeLine = puzzle.book_lines?.[activeLineIdx];
      if (activeLine && sequenceMoveIdx !== -1) {
        const currentCorrectMove = activeLine.moves[sequenceMoveIdx];
        if (currentCorrectMove) {
          const chess = new Chess(boardFen);
          try {
            const m = chess.move({ 
              from: currentCorrectMove.uci.slice(0, 2), 
              to: currentCorrectMove.uci.slice(2, 4), 
              promotion: currentCorrectMove.uci[4] 
            });
            playMoveSound(m ? m.san.includes('x') : false);
          } catch {}
          setBoardFen(chess.fen());

          const isLastMove = sequenceMoveIdx + 1 >= activeLine.moves.length;
          if (puzzle.is_sequence && !isLastMove) {
            setSequenceMoveIdx(prev => prev + 1);
            setHint(`Revealed: ${currentCorrectMove.san}. Keep playing the sequence...`);
            setTimeout(() => {
              setHint(null);
            }, 2000);
            setStatus('playing');
            return;
          }
        }
      }
      setStatus('solved');
      return;
    }

    const chess = new Chess(boardFen);
    try {
      const m = chess.move({ from: puzzle.solution_uci.slice(0, 2), to: puzzle.solution_uci.slice(2, 4), promotion: puzzle.solution_uci[4] });
      const isCapture = m ? m.san.includes('x') : false;
      playMoveSound(isCapture);
    } catch {}
    setBoardFen(chess.fen());
    setStatus('solved');
  }, [puzzle, boardFen, reportAttempt, puzzleType, activeLineIdx, sequenceMoveIdx]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare, piece }: any) => {
    if (!puzzle || status !== 'playing') return false;
    const promo = getPromoPiece(piece.pieceType, targetSquare);
    if (!isLegalMove(boardFen, sourceSquare, targetSquare, promo)) return false;
    const uci = sourceSquare + targetSquare + (promo || '');

    if (puzzleType === 'book') {
      const activeLine = puzzle.book_lines?.[activeLineIdx];
      if (!activeLine || sequenceMoveIdx === -1) return false;
      const currentCorrectMove = activeLine.moves[sequenceMoveIdx];
      if (!currentCorrectMove) return false;

      if (uci === currentCorrectMove.uci) {
        const chess = new Chess(boardFen);
        try {
          const m = chess.move({ from: sourceSquare, to: targetSquare, promotion: promo });
          const isCapture = m ? m.san.includes('x') : false;
          playMoveSound(isCapture);
        } catch {}
        
        setBoardFen(currentCorrectMove.fen_after);
        setSequenceMoveIdx(prev => prev + 1);

        const isLastMove = sequenceMoveIdx + 1 >= activeLine.moves.length;
        if (!isLastMove) {
          setHint("Correct! Keep playing the sequence...");
          setTimeout(() => {
            setHint(null);
          }, 1500);
        }
        return true;
      } else {
        playErrorSound();
        setHasMadeMistake(true);
        setStatus('incorrect');
        setTimeout(() => {
          setBoardFen(currentCorrectMove.fen_before);
          setStatus('playing');
        }, 1000);
        return true;
      }
    }

    const ok = isAcceptableMove(uci, puzzle, evaluation);
    if (ok) {
      setHint(null);
      reportAttempt(!hasMadeMistake);
      const chess = new Chess(boardFen);
      try {
        const m = chess.move({ from: sourceSquare, to: targetSquare, promotion: promo });
        const isCapture = m ? m.san.includes('x') : false;
        playMoveSound(isCapture);
      } catch {}
      applyCorrectMove(sourceSquare, targetSquare, promo, boardFen, setBoardFen, setStatus);
    } else {
      playErrorSound();
      setHasMadeMistake(true);
      if (puzzleType === 'zwischenzug' && uci === puzzle.blunder_uci) {
        const isCap = puzzle.description?.toLowerCase().includes('captured') || puzzle.description?.toLowerCase().includes('capture');
        setHint(isCap 
          ? "Recapturing immediately is too slow. Look for a more dangerous intermediate threat!" 
          : "Defending directly is too passive. Look for a forcing intermediate counter-threat!"
        );
      } else if (puzzleType === 'weakness' && uci === puzzle.blunder_uci) {
        setHint(`That is the move you played in the game (${puzzle.blunder_san}) which led to a loss. Find the engine's best move instead!`);
      } else {
        setHint(null);
      }
      handleWrongMove(puzzle, setBoardFen, setStatus);
    }
    return ok;
  }, [puzzle, boardFen, status, evaluation, puzzleType, hasMadeMistake, reportAttempt, activeLineIdx, sequenceMoveIdx]);

  const squareRenderer = useCallback(
    ({ square, children }: any) => {
      const dest = puzzle?.blunder_uci?.slice(2, 4);
      return (
        <div className="relative w-full h-full">
          {children}
          {square === dest && <BlunderBadge />}
        </div>
      );
    },
    [puzzle]
  );

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex items-center justify-center p-6 bg-zinc-950 relative">
        {status === 'loading' ? (
          <div className="text-zinc-400 text-sm animate-pulse">Loading next puzzle...</div>
        ) : status === 'error' || !puzzle ? (
          <div className="text-zinc-450 text-sm text-center max-w-md px-6 py-8 bg-zinc-900 border border-zinc-850 rounded-xl shadow-lg">
            <span className="text-2xl block mb-3">🧩</span>
            {puzzleType === 'book'
              ? 'No book puzzles found. Make sure you have games imported and book moves indexed!'
              : 'No puzzles available. Try scanning your library!'}
          </div>
        ) : (
          <div className="relative aspect-square shadow-2xl rounded-lg overflow-hidden border border-zinc-800/40" style={{ width: 'min(calc(100vh - 120px), calc(100vw - 440px))' }}>
            <ChessboardProvider
              options={{
                position: boardFen,
                boardOrientation: puzzle.player_color === 'w' ? 'white' : 'black',
                onPieceDrop,
                squareRenderer,
                darkSquareStyle: { backgroundColor: '#b58863' },
                lightSquareStyle: { backgroundColor: '#f0d9b5' },
              }}
            >
              <Chessboard />
            </ChessboardProvider>
            {puzzle.blunder_uci && (
              <BlunderArrow
                from={puzzle.blunder_uci.slice(0, 2)}
                to={puzzle.blunder_uci.slice(2, 4)}
                orientation={puzzle.player_color === 'w' ? 'white' : 'black'}
              />
            )}
          </div>
        )}
      </div>
      <div className="w-[380px] border-l border-zinc-900 bg-zinc-950/80 backdrop-blur-md p-6 flex flex-col justify-between shrink-0 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2 mb-6">🧩 Personal Puzzles</h2>
          
          <div className="grid grid-cols-4 bg-zinc-900 p-0.5 rounded-lg mb-6 border border-zinc-850 gap-0.5">
            {PUZZLE_TYPES.map((t) => (
              <button
                key={t.id}
                onClick={() => handleTypeChange(t.id)}
                className={`py-1.5 text-[10px] font-semibold rounded-md transition-all cursor-pointer truncate ${
                  puzzleType === t.id ? 'bg-zinc-800 text-zinc-100 shadow-sm' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="mb-6 grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-1.5 font-sans">
                Opening Filter
              </label>
              <select
                value={selectedOpening}
                onChange={(e) => setSelectedOpening(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-850 rounded-lg py-2 px-3 text-xs text-zinc-350 font-semibold focus:outline-none focus:border-zinc-700 cursor-pointer transition-colors"
              >
                <option value="all">All Openings</option>
                {openings.map((op) => (
                  <option key={`${op.id}_${op.color}`} value={`${op.id}_${op.color}`}>
                    {op.name} ({op.color === 'w' ? 'White' : 'Black'})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] uppercase font-bold tracking-wider text-zinc-500 mb-1.5 font-sans">
                Recency Filter
              </label>
              <select
                value={selectedRecency}
                onChange={(e) => setSelectedRecency(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-850 rounded-lg py-2 px-3 text-xs text-zinc-350 font-semibold focus:outline-none focus:border-zinc-700 cursor-pointer transition-colors"
              >
                <option value="all">All Time</option>
                <option value="7">Last 7 Days</option>
                <option value="14">Last 14 Days</option>
                <option value="30">Last 30 Days</option>
                <option value="90">Last 90 Days</option>
              </select>
            </div>
          </div>

          {puzzle && (
            <>
              <PuzzlePrompt 
                desc={puzzle.description} 
                title={puzzle.game_title} 
                evaluation={evaluation} 
                bookLine={bookLine} 
                onLoadGame={onLoadGame && puzzle.game_pgn ? () => onLoadGame(puzzle.game_pgn, puzzle.start_fen, puzzle.game_id) : undefined}
              />
              <StatusCard status={status} solution={puzzle.solution_san} puzzleType={puzzleType} hint={hint} isSequence={puzzle.is_sequence} />
              {status === 'playing' && hint && (
                <div className="mt-2 text-xs text-rose-300 bg-rose-950/20 border border-rose-900/40 rounded p-2.5 text-center leading-relaxed">
                  💡 Hint: {hint}
                </div>
              )}
              {(status === 'correct' || status === 'solved') && puzzleType === 'zwischenzug' && (
                <ZwischenzugExplanation evaluation={evaluation} puzzle={puzzle} />
              )}
              {(status === 'correct' || status === 'solved') && (puzzleType === 'winning_position' || puzzleType === 'defensive' || puzzleType === 'endgame' || puzzleType === 'opening') && (
                <BlunderDiffExplanation evaluation={evaluation} blunderEvaluation={blunderEvaluation} puzzle={puzzle} type={puzzleType} />
              )}
              {(status === 'correct' || status === 'solved') && (
                puzzleType === 'book' ? (
                  <BookLinesList 
                    bookLines={puzzle.book_lines} 
                    boardFen={boardFen} 
                    setBoardFen={setBoardFen} 
                    activeLineIdx={activeLineIdx}
                    setActiveLineIdx={setActiveLineIdx}
                    activeMoveIdx={activeMoveIdx}
                  />
                ) : (
                  <>
                    <BestLineViewer moves={bestLineMoves} boardFen={boardFen} setBoardFen={setBoardFen} startFen={puzzle.start_fen} />
                    <CandidateMovesList evaluation={evaluation} startFen={puzzle.start_fen} />
                  </>
                )
              )}
            </>
          )}
        </div>
        <PuzzleControls status={status} onNext={loadNext} onReveal={onReveal} onExit={onExit} />
      </div>
    </div>
  );
}
