'use client';

import { useCallback, useEffect, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, ChessboardProvider } from 'react-chessboard';
import { useStockfish } from '../hooks/useStockfish';
import { useBookMoves } from '../hooks/useBookMoves';
import { useGameAnalysis, HistoryEntry, STARTING_FEN } from '../hooks/useGameAnalysis';
import { EvalBar } from './EvalBar';
import { MoveList } from './MoveList';
import { GameGraph } from './GameGraph';

type Arrow = { startSquare: string; endSquare: string; color: string };

const ANNOTATION_ICONS: Record<string, { symbol: string; bg: string; text: string }> = {
  book:      { symbol: '📖', bg: '#2563eb', text: '#ffffff' },
  brilliant: { symbol: '!!', bg: '#0d9488', text: '#ffffff' },
  mistake:   { symbol: '?',  bg: '#ea580c', text: '#ffffff' },
  blunder:   { symbol: '??', bg: '#dc2626', text: '#ffffff' },
};

export function ChessAnalysis() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [pgnInput, setPgnInput] = useState('');
  const [pgnError, setPgnError] = useState('');
  const [showPgnPanel, setShowPgnPanel] = useState(false);
  const [hoveredBook, setHoveredBook] = useState<string | null>(null);

  const { ready, evaluation, analyse } = useStockfish();
  const { moves: bookMoves, inBook } = useBookMoves(cursor < 0 ? STARTING_FEN : history[cursor]?.fen ?? STARTING_FEN);
  const { annotations, analyzing, progress, analyzeGame, analyzeLastMove, reset: resetAnalysis } = useGameAnalysis();

  const currentFen = cursor < 0 ? STARTING_FEN : history[cursor].fen;
  const currentColor = (cursor < 0 ? 'w' : cursor % 2 === 0 ? 'b' : 'w') as 'w' | 'b';

  // Real-time engine analysis of current position
  useEffect(() => {
    if (!ready) return;
    analyse(currentFen, currentColor, 22);
  }, [ready, currentFen, currentColor, analyse]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(-1, c - 1));
      else if (e.key === 'ArrowRight') setCursor((c) => Math.min(history.length - 1, c + 1));
      else if (e.key === 'ArrowUp') setCursor(-1);
      else if (e.key === 'ArrowDown') setCursor(history.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history.length]);

  // Interactive piece drop
  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare, piece }: { sourceSquare: string; targetSquare: string | null; piece: { pieceType: string } }) => {
      if (!targetSquare) return false;
      const chess = new Chess(currentFen);
      const promo =
        piece.pieceType.toLowerCase().endsWith('p') &&
        ((piece.pieceType[0] === 'P' && targetSquare[1] === '8') ||
          (piece.pieceType[0] === 'p' && targetSquare[1] === '1'))
          ? 'q' : undefined;
      try {
        const move = chess.move({ from: sourceSquare, to: targetSquare, promotion: promo });
        if (!move) return false;
        const newEntry: HistoryEntry = { fen: chess.fen(), san: move.san, to: move.to };
        setHistory((prev) => {
          const next = [...prev.slice(0, cursor + 1), newEntry];
          // Analyze the new move after state updates
          setTimeout(() => analyzeLastMove(next), 0);
          return next;
        });
        setCursor((c) => c + 1);
        return true;
      } catch {
        return false;
      }
    },
    [currentFen, cursor, analyzeLastMove]
  );

  // PGN load
  const loadPgn = useCallback(() => {
    try {
      const chess = new Chess();
      chess.loadPgn(pgnInput.trim());
      const headers = chess.header();
      const moves = chess.history({ verbose: true });
      const entries: HistoryEntry[] = [];
      const replay = new Chess();
      for (const m of moves) {
        replay.move(m.san);
        entries.push({ fen: replay.fen(), san: m.san, to: m.to });
      }
      const username = 'demanzonderjas';
      const whitePlayer = (headers['White'] ?? '').toLowerCase();
      const blackPlayer = (headers['Black'] ?? '').toLowerCase();
      if (blackPlayer.includes(username)) setOrientation('black');
      else if (whitePlayer.includes(username)) setOrientation('white');
      setHistory(entries);
      setCursor(entries.length - 1);
      setPgnError('');
      setShowPgnPanel(false);
      setPgnInput('');
      resetAnalysis();
      analyzeGame(entries);
    } catch {
      setPgnError('Invalid PGN — check the format and try again.');
    }
  }, [pgnInput, analyzeGame, resetAnalysis]);

  // Arrows
  const arrowMap = new Map<string, Arrow>();
  for (const bm of bookMoves) {
    if (bm.uci.length >= 4) {
      const key = `${bm.uci.slice(0, 2)}-${bm.uci.slice(2, 4)}`;
      const isHovered = hoveredBook === bm.san;
      arrowMap.set(key, {
        startSquare: bm.uci.slice(0, 2),
        endSquare: bm.uci.slice(2, 4),
        color: isHovered ? 'rgba(96,165,250,0.95)' : bm.isMainline ? 'rgba(96,165,250,0.55)' : 'rgba(96,165,250,0.25)',
      });
    }
  }
  if (evaluation.bestMove && evaluation.bestMove.length >= 4) {
    const key = `${evaluation.bestMove.slice(0, 2)}-${evaluation.bestMove.slice(2, 4)}`;
    arrowMap.set(key, {
      startSquare: evaluation.bestMove.slice(0, 2),
      endSquare: evaluation.bestMove.slice(2, 4),
      color: 'rgba(0,200,100,0.8)',
    });
  }
  const arrows: Arrow[] = Array.from(arrowMap.values());

  // Board annotation overlay — show icon on the destination square of the current move
  const annotationSquare = cursor >= 0 ? history[cursor]?.to : null;
  const currentAnnotation = cursor >= 0 ? annotations[cursor] : null;

  const squareRenderer = useCallback(
    ({ square, children }: { piece: { pieceType: string } | null; square: string; children?: React.ReactNode }) => {
      const icons = square === annotationSquare && currentAnnotation?.types.length
        ? currentAnnotation.types
        : [];
      return (
        <div style={{ position: 'relative', width: '100%', height: '100%' }}>
          {children}
          {icons.length > 0 && (
            <div style={{
              position: 'absolute', top: 3, right: 3, zIndex: 20,
              display: 'flex', gap: 3, pointerEvents: 'none',
            }}>
              {icons.map((t) => {
                const icon = ANNOTATION_ICONS[t];
                return icon ? (
                  <span
                    key={t}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: t === 'book' ? '56px' : '48px',
                      height: t === 'book' ? '56px' : '48px',
                      borderRadius: '50%',
                      backgroundColor: icon.bg,
                      color: icon.text,
                      fontSize: t === 'book' ? '32px' : '24px',
                      fontWeight: 'bold',
                      border: '3px solid #ffffff',
                      boxShadow: '0 4px 8px rgba(0,0,0,0.5)',
                      lineHeight: 1,
                    }}
                  >
                    {icon.symbol}
                  </span>
                ) : null;
              })}
            </div>
          )}
        </div>
      );
    },
    [annotationSquare, currentAnnotation]
  );

  const evalLabel = () => {
    const { mate, score } = evaluation;
    if (mate !== null) return `M${Math.abs(mate)}`;
    if (score === null) return '0.00';
    const cp = score / 100;
    return (cp >= 0 ? '+' : '') + cp.toFixed(2);
  };

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-2 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xl font-bold tracking-tight">♟ Chaz</span>
          <span className="text-xs text-zinc-500">
            Stockfish 18{' '}
            {ready ? <span className="text-green-500">● ready</span> : <span className="text-yellow-500">● loading…</span>}
          </span>
          {inBook && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 border border-blue-700">
              📖 in book
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {history.length > 0 && (
            analyzing ? (
              <span className="text-xs px-3 py-1 rounded bg-yellow-900/50 text-yellow-300 border border-yellow-800">
                Analyzing… {progress}%
              </span>
            ) : annotations.length > 0 ? (
              <button onClick={() => analyzeGame(history)}
                className="text-xs px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">
                Re-analyze
              </button>
            ) : null
          )}
          <button onClick={() => setShowPgnPanel((v) => !v)}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
            {showPgnPanel ? 'Close PGN' : 'Import PGN'}
          </button>
          <button onClick={() => setOrientation((o) => o === 'white' ? 'black' : 'white')}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
            Flip ⇅
          </button>
          <button onClick={() => { setHistory([]); setCursor(-1); resetAnalysis(); }}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
            Reset
          </button>
        </div>
      </header>

      {/* PGN panel */}
      {showPgnPanel && (
        <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0">
          <textarea value={pgnInput} onChange={(e) => setPgnInput(e.target.value)}
            placeholder="Paste PGN here…"
            className="w-full h-28 bg-zinc-800 rounded p-2 text-sm font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-500" />
          {pgnError && <p className="text-red-400 text-xs mt-1">{pgnError}</p>}
          <button onClick={loadPgn}
            className="mt-2 text-sm px-4 py-1 rounded bg-blue-600 hover:bg-blue-500 transition-colors">
            Load game
          </button>
        </div>
      )}

      {/* Main area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Eval bar */}
        <div className="flex items-stretch px-2 py-2 shrink-0">
          <EvalBar evaluation={evaluation} orientation={orientation} />
        </div>

        {/* Board */}
        <div className="flex flex-col items-center justify-center flex-1 p-2 gap-4">
          <div style={{ width: 'min(calc(100vh - 280px), calc(100vw - 380px))', aspectRatio: '1' }}>
            <ChessboardProvider
              options={{
                position: currentFen,
                boardOrientation: orientation,
                arrows,
                allowDrawingArrows: true,
                animationDurationInMs: 150,
                darkSquareStyle: { backgroundColor: '#4a7c59' },
                lightSquareStyle: { backgroundColor: '#f0d9b5' },
                onPieceDrop,
                squareRenderer,
              }}
            >
              <Chessboard />
            </ChessboardProvider>
          </div>
          <div className="w-full overflow-visible" style={{ maxWidth: 'min(calc(100vh - 280px), calc(100vw - 380px))' }}>
            <GameGraph annotations={annotations} currentIndex={cursor} onSelect={(i) => setCursor(i)} />
          </div>
        </div>

        {/* Right panel */}
        <div className="w-80 flex flex-col border-l border-zinc-800 shrink-0">
          {/* Eval summary */}
          <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-bold tabular-nums">{evalLabel()}</span>
              <span className="text-xs text-zinc-500">depth {evaluation.depth}</span>
            </div>
            {evaluation.pv.length > 0 && (
              <p className="text-xs text-zinc-400 mt-1 truncate font-mono">
                {evaluation.pv.slice(0, 5).join(' ')}
              </p>
            )}
          </div>

          {/* Book moves */}
          {bookMoves.length > 0 && (
            <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
              <p className="text-[10px] uppercase tracking-widest text-zinc-500 mb-1.5">Book moves</p>
              <div className="flex flex-wrap gap-1">
                {bookMoves.map((bm) => (
                  <div key={bm.san} className="relative group"
                    onMouseEnter={() => setHoveredBook(bm.san)}
                    onMouseLeave={() => setHoveredBook(null)}>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-mono cursor-default border transition-colors ${
                      bm.isMainline ? 'bg-blue-900/50 border-blue-600 text-blue-200' : 'bg-zinc-800 border-zinc-600 text-zinc-300'
                    }`}>
                      {bm.isMainline && <span className="text-blue-400 text-[10px]">●</span>}
                      {bm.san}
                      <span className="text-zinc-500 text-[10px]">×{bm.lineCount}</span>
                    </span>
                    {bm.lineNames.length > 0 && (
                      <div className="absolute bottom-full left-0 mb-1 z-50 hidden group-hover:block w-56 bg-zinc-900 border border-zinc-700 rounded p-2 shadow-xl">
                        <p className="text-[10px] text-zinc-400 font-semibold mb-1">{bm.lineCount} line{bm.lineCount !== 1 ? 's' : ''}</p>
                        {bm.lineNames.map((name, i) => (
                          <p key={i} className="text-[10px] text-zinc-300 leading-tight truncate">{name}</p>
                        ))}
                        {bm.lineCount > bm.lineNames.length && (
                          <p className="text-[10px] text-zinc-500 mt-0.5">+{bm.lineCount - bm.lineNames.length} more</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Move list */}
          <div className="flex-1 overflow-hidden">
            <MoveList
              sanMoves={history.map((h) => h.san)}
              currentIndex={cursor}
              annotations={annotations}
              onSelect={(i) => setCursor(i)}
            />
          </div>

          {/* Navigation */}
          <div className="flex gap-1 px-2 py-2 border-t border-zinc-800 shrink-0">
            {[
              { label: '⏮', action: () => setCursor(-1), title: 'Start' },
              { label: '◀', action: () => setCursor((c) => Math.max(-1, c - 1)), title: 'Prev (←)' },
              { label: '▶', action: () => setCursor((c) => Math.min(history.length - 1, c + 1)), title: 'Next (→)' },
              { label: '⏭', action: () => setCursor(history.length - 1), title: 'End' },
            ].map(({ label, action, title }) => (
              <button key={label} onClick={action} title={title}
                className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors">
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
