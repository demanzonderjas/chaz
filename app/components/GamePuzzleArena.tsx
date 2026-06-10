'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, ChessboardProvider } from 'react-chessboard';
import { playMoveSound, playErrorSound } from '../services/sound';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

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

const BlunderBadge = () => (
  <div className="absolute top-[3px] right-[3px] z-20 flex pointer-events-none">
    <span className="flex items-center justify-center rounded-full border-[2.5px] border-white shadow-[0_2px_4px_rgba(0,0,0,0.4)] font-bold leading-none w-8 h-8 text-sm bg-[#dc2626] text-white">??</span>
  </div>
);

function getEvalLabel(ev: any): string {
  if (!ev) return '';
  if (ev.mate !== undefined && ev.mate !== null) return ev.mate === 0 ? '#' : `M${Math.abs(ev.mate)}`;
  const cpVal = ev.cp ?? ev.score;
  if (cpVal === undefined || cpVal === null) return '';
  const val = cpVal / 100;
  return (val >= 0 ? '+' : '') + val.toFixed(2);
}

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

function getSan(fen: string, uci: string): string {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m ? m.san : uci;
  } catch {
    return uci;
  }
}

function applyCorrectMove(src: string, dst: string, promo: string | undefined, boardFen: string, setBoardFen: any, setStatus: any) {
  const chess = new Chess(boardFen);
  chess.move({ from: src, to: dst, promotion: promo });
  setBoardFen(chess.fen());
  setStatus('correct');
}

function handleWrongMove(mistake: any, setBoardFen: any, setStatus: any) {
  setStatus('incorrect');
  setTimeout(() => {
    setBoardFen(mistake.startFen);
    setStatus('playing');
  }, 1000);
}

const GamePuzzleHeader = ({ index, total, evaluation }: any) => (
  <div className="flex justify-between items-start mb-1.5">
    <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Mistake {index + 1} of {total}</span>
    {evaluation && <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-bold bg-zinc-800 text-zinc-300 border border-zinc-700">Eval: {getEvalLabel(evaluation)}</span>}
  </div>
);

const GamePuzzlePrompt = ({ mistake, gameTitle, index, total, evaluation }: any) => (
  <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg shadow-md mb-4">
    <GamePuzzleHeader index={index} total={total} evaluation={evaluation} />
    <div className="text-sm font-bold text-zinc-100 mb-3 leading-relaxed">
      {mistake.isMissedBook ? 'You played a non-book move: ' : 'You played '}<span className="text-rose-450 font-extrabold">{mistake.playedSan}</span>{mistake.cpLoss !== undefined && <span className="text-rose-400 font-semibold text-xs ml-1">(-{(mistake.cpLoss / 100).toFixed(2)})</span>}. Find the correct move!
    </div>
    <div className="text-[10px] uppercase font-bold text-zinc-500 mb-0.5">Source Game</div>
    <div className="text-xs text-zinc-300 truncate">{gameTitle}</div>
  </div>
);

function moveSafe(chess: Chess, m: string) {
  try {
    const r = chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    return { san: r.san, fen: chess.fen() };
  } catch { return null; }
}

function getBestLineMoves(mistake: any): { san: string; fen: string }[] {
  const pv = mistake?.evaluation?.pv || [], chess = new Chess(mistake?.startFen);
  return pv.slice(0, 14).map((m: string) => moveSafe(chess, m)).filter(Boolean) as any;
}

const BestLineViewer = ({ moves, boardFen, setBoardFen, startFen, theme }: any) =>
  !moves?.length ? null : (
    <div className="flex flex-wrap gap-1 items-center justify-center mt-1">
      <span className={`text-[10px] uppercase font-bold mr-1 ${theme === 'emerald' ? 'text-emerald-500' : 'text-blue-350'}`}>Best line:</span>
      <button onClick={() => setBoardFen(startFen)} className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${boardFen === startFen ? (theme === 'emerald' ? 'bg-emerald-800 border-emerald-600 text-white' : 'bg-blue-800 border-blue-600 text-white') : (theme === 'emerald' ? 'bg-emerald-950 border-emerald-900 text-emerald-400' : 'bg-blue-950 border-blue-900 text-blue-400')}`}>Start</button>
      {moves.map((m: any, i: number) => (
        <button key={i} onClick={() => setBoardFen(m.fen)} className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${boardFen === m.fen ? (theme === 'emerald' ? 'bg-emerald-800 border-emerald-600 text-white' : 'bg-blue-800 border-blue-600 text-white') : (theme === 'emerald' ? 'bg-emerald-950 border-emerald-900 text-emerald-400' : 'bg-blue-950 border-blue-900 text-blue-400')}`}>{m.san}</button>
      ))}
    </div>
  );

const CorrectStatus = ({ bestLineMoves, boardFen, setBoardFen, startFen }: any) => (
  <div className="p-3 bg-emerald-950/60 border border-emerald-800 text-emerald-450 rounded text-sm font-semibold text-center shadow-lg flex flex-col gap-1.5">
    <div>✨ CORRECT! You found the best move.</div>
    <BestLineViewer moves={bestLineMoves} boardFen={boardFen} setBoardFen={setBoardFen} startFen={startFen} theme="emerald" />
  </div>
);

const SolvedStatus = ({ solution, bestLineMoves, boardFen, setBoardFen, startFen }: any) => (
  <div className="p-3 bg-blue-950/60 border border-blue-800 text-blue-400 rounded text-sm font-semibold text-center shadow-lg flex flex-col gap-1.5">
    <div>💡 Solution: {solution}</div>
    <BestLineViewer moves={bestLineMoves} boardFen={boardFen} setBoardFen={setBoardFen} startFen={startFen} theme="blue" />
  </div>
);

const GameStatusCard = ({ status, solution, bestLineMoves, boardFen, setBoardFen, startFen }: any) => {
  if (status === 'correct') return <CorrectStatus bestLineMoves={bestLineMoves} boardFen={boardFen} setBoardFen={setBoardFen} startFen={startFen} />;
  if (status === 'solved') return <SolvedStatus solution={solution} bestLineMoves={bestLineMoves} boardFen={boardFen} setBoardFen={setBoardFen} startFen={startFen} />;
  if (status === 'incorrect') return <div className="p-3 bg-rose-950/60 border border-rose-800 text-rose-400 rounded text-sm font-semibold text-center shadow-lg">❌ INCORRECT! That is a mistake, try again.</div>;
  return <div className="p-3 bg-zinc-900 border border-zinc-800 text-zinc-400 rounded text-sm text-center">Make your move on the board...</div>;
};

const GamePuzzleControls = ({ status, isLast, onNext, onReveal, onExit }: any) => (
  <div className="flex flex-col gap-2 mt-4">
    {status !== 'playing' && !isLast && <button onClick={onNext} className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-sm font-semibold transition-all cursor-pointer shadow-md">Next Mistake</button>}
    <button onClick={onReveal} disabled={status === 'solved' || status === 'correct'} className="w-full py-2 bg-zinc-850 hover:bg-zinc-800 disabled:opacity-40 disabled:cursor-not-allowed text-zinc-300 rounded text-sm font-semibold transition-all border border-zinc-700 cursor-pointer">Show Solution</button>
    <button onClick={onExit} className="w-full py-2 bg-zinc-950 hover:bg-zinc-900 text-zinc-400 rounded text-sm font-semibold transition-all border border-zinc-850 cursor-pointer mt-4">Exit Practice</button>
  </div>
);

export function GamePuzzleArena({ mistakes, gameTitle, playerColor, onExit }: { mistakes: any[]; gameTitle: string; playerColor: 'white' | 'black'; onExit: () => void }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<'playing' | 'correct' | 'incorrect' | 'solved'>('playing');
  const activeMistake = mistakes[currentIndex];
  const [boardFen, setBoardFen] = useState(activeMistake?.startFen ?? STARTING_FEN);

  useEffect(() => {
    if (activeMistake) {
      setBoardFen(activeMistake.startFen);
      setStatus('playing');
    }
  }, [currentIndex, activeMistake]);

  useEffect(() => {
    if (status !== 'correct' && status !== 'solved') return;
    const moves = getBestLineMoves(activeMistake);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const idx = moves.findIndex((m) => m.fen === boardFen), isR = e.key === 'ArrowRight';
      if (isR && idx < moves.length - 1) {
        setBoardFen(moves[idx + 1].fen); playMoveSound(moves[idx + 1].san.includes('x'));
      } else if (!isR) {
        setBoardFen(idx > 0 ? moves[idx - 1].fen : activeMistake.startFen); playMoveSound(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, activeMistake, boardFen]);



  const onReveal = useCallback(() => {
    if (!activeMistake) return;
    const chess = new Chess(boardFen);
    try {
      const m = chess.move({ from: activeMistake.solutionUci.slice(0, 2), to: activeMistake.solutionUci.slice(2, 4), promotion: activeMistake.solutionUci[4] });
      playMoveSound(m ? m.san.includes('x') : false);
    } catch {}
    setBoardFen(chess.fen());
    setStatus('solved');
  }, [activeMistake, boardFen]);

  const onPieceDrop = useCallback(({ sourceSquare, targetSquare, piece }: any) => {
    if (!activeMistake || status !== 'playing') return false;
    const promo = getPromoPiece(piece.pieceType, targetSquare);
    if (!isLegalMove(boardFen, sourceSquare, targetSquare, promo)) return false;
    const uci = sourceSquare + targetSquare + (promo || '');
    const ok = uci === activeMistake.solutionUci || (activeMistake.solutionUcis && activeMistake.solutionUcis.includes(uci));
    if (ok) {
      const chess = new Chess(boardFen);
      try {
        const m = chess.move({ from: sourceSquare, to: targetSquare, promotion: promo });
        playMoveSound(m ? m.san.includes('x') : false);
      } catch {}
      applyCorrectMove(sourceSquare, targetSquare, promo, boardFen, setBoardFen, setStatus);
    } else {
      playErrorSound();
      handleWrongMove(activeMistake, setBoardFen, setStatus);
    }
    return ok;
  }, [activeMistake, boardFen, status]);

  const squareRenderer = useCallback(({ square, children }: any) => {
    const dest = activeMistake?.playedUci?.slice(2, 4);
    return <div className="relative w-full h-full">{children}{square === dest && <BlunderBadge />}</div>;
  }, [activeMistake]);

  if (!activeMistake) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 text-zinc-400 p-6 text-center">
        <h2 className="text-xl font-bold text-zinc-100 mb-2">🎉 Practice Completed!</h2>
        <p className="text-sm text-zinc-400 mb-6">You corrected all mistakes in this game.</p>
        <div className="flex gap-3 w-64">
          <button onClick={() => setCurrentIndex(0)} className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded text-sm transition-all cursor-pointer">Retry All</button>
          <button onClick={onExit} className="flex-1 py-2 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 font-semibold rounded text-sm transition-all border border-zinc-700 cursor-pointer">Exit</button>
        </div>
      </div>
    );
  }

  const isLast = currentIndex === mistakes.length - 1;
  const onNext = () => setCurrentIndex(c => c + 1);

  return (
    <div className="flex flex-1 overflow-hidden">
      <div className="flex-1 flex items-center justify-center p-6 bg-zinc-950 relative">
        <div className="relative aspect-square shadow-2xl rounded-lg overflow-hidden border border-zinc-800/40" style={{ width: 'min(calc(100vh - 120px), calc(100vw - 440px))' }}>
          <ChessboardProvider options={{ position: boardFen, boardOrientation: playerColor, onPieceDrop, squareRenderer }}>
            <Chessboard />
          </ChessboardProvider>
          {activeMistake.playedUci && (
            <BlunderArrow
              from={activeMistake.playedUci.slice(0, 2)}
              to={activeMistake.playedUci.slice(2, 4)}
              orientation={playerColor}
            />
          )}
        </div>
      </div>
      <div className="w-[380px] border-l border-zinc-900 bg-zinc-950/80 backdrop-blur-md p-6 flex flex-col justify-between shrink-0 overflow-y-auto">
        <div>
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2 mb-6">🧩 Game Puzzles</h2>
          <GamePuzzlePrompt mistake={activeMistake} gameTitle={gameTitle} index={currentIndex} total={mistakes.length} evaluation={activeMistake.evaluation} />
          <GameStatusCard status={status} solution={activeMistake.solutionSan} bestLineMoves={getBestLineMoves(activeMistake)} boardFen={boardFen} setBoardFen={setBoardFen} startFen={activeMistake.startFen} />
        </div>
        <GamePuzzleControls status={status} isLast={isLast} onNext={onNext} onReveal={onReveal} onExit={onExit} />
      </div>
    </div>
  );
}
