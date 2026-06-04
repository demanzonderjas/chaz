'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Chess } from 'chess.js';
import { Chessboard, ChessboardProvider } from 'react-chessboard';
import { useStockfish } from '../hooks/useStockfish';
import { useBookMoves } from '../hooks/useBookMoves';
import { useGameAnalysis, HistoryEntry, STARTING_FEN } from '../hooks/useGameAnalysis';
import { EvalBar } from './EvalBar';
import { MoveList } from './MoveList';
import { GameGraph } from './GameGraph';
import { DbExplorer } from './DbExplorer';
import { GameLibrary } from './GameLibrary';
import { PuzzleArena } from './PuzzleArena';
import { playMoveSound } from '../services/sound';

type Arrow = { startSquare: string; endSquare: string; color: string };

const ANNOTATION_ICONS: Record<string, { symbol: string; bg: string; text: string }> = {
  book:      { symbol: '📖', bg: '#2563eb', text: '#ffffff' },
  brilliant: { symbol: '!!', bg: '#0d9488', text: '#ffffff' },
  mistake:   { symbol: '?',  bg: '#ea580c', text: '#ffffff' },
  blunder:   { symbol: '??', bg: '#dc2626', text: '#ffffff' },
};

interface GameMeta {
  white: string;
  black: string;
  result: string;
  date: string;
}

function getResultStyle(res: string) {
  if (res === '1-0') return 'bg-emerald-950/60 text-emerald-400 border border-emerald-800';
  if (res === '0-1') return 'bg-rose-950/60 text-rose-400 border border-rose-800';
  return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
}

const ActiveGameHeader = ({ game, onClear, relevantBookLine, onExploreBookLine }: any) => (
  <div className="flex items-center justify-between px-6 py-2.5 bg-zinc-900/60 border-b border-zinc-800 backdrop-blur-md shrink-0">
    <div className="flex items-center gap-4 flex-wrap">
      <span className="text-sm font-semibold text-zinc-100 flex items-center gap-2">⚪ {game.white} <span className="text-zinc-500 font-light">vs</span> ⚫ {game.black}</span>
      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${getResultStyle(game.result)}`}>{game.result}</span>
      <span className="text-xs text-zinc-500">📅 {game.date}</span>
      {relevantBookLine && (
        <button
          onClick={onExploreBookLine}
          className="text-xs text-blue-400 hover:text-blue-300 hover:underline font-semibold flex items-center gap-1 cursor-pointer transition-all"
          title="Explore opening line"
        >
          📖 {relevantBookLine.name}
        </button>
      )}
    </div>
    <button onClick={onClear} className="text-zinc-500 hover:text-rose-450 text-xs px-2.5 py-1 rounded bg-zinc-800/80 hover:bg-rose-950/40 hover:border-rose-905 border border-zinc-705 transition-all cursor-pointer">Unload Game</button>
  </div>
);

export function ChessAnalysis() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [cursor, setCursor] = useState(-1);
  const [initialFen, setInitialFen] = useState(STARTING_FEN);
  const [activeGame, setActiveGame] = useState<(GameMeta & { id?: number }) | null>(null);
  const [mode, setMode] = useState<'analysis' | 'puzzles'>('analysis');
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [pgnInput, setPgnInput] = useState('');
  const [pgnError, setPgnError] = useState('');
  const [showPgnPanel, setShowPgnPanel] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [baseState, setBaseState] = useState<{ history: HistoryEntry[]; cursor: number } | null>(null);
  const [hoveredBook, setHoveredBook] = useState<string | null>(null);
  const [relevantBookLine, setRelevantBookLine] = useState<any | null>(null);
  const [explorerLine, setExplorerLine] = useState<any | null>(null);
  const [explorerMoveIdx, setExplorerMoveIdx] = useState<number>(-1);

  const { ready, evaluation, analyse } = useStockfish();
  const { annotations, analyzing, progress, analyzeGame, analyzeLastMove, reset: resetAnalysis } = useGameAnalysis();

  const currentFen = cursor < 0 ? initialFen : history[cursor].fen;
  const currentColor = (cursor < 0 ? 'w' : cursor % 2 === 0 ? 'b' : 'w') as 'w' | 'b';

  const explorerFen = explorerLine 
    ? (explorerMoveIdx === -1 ? explorerLine.start_fen : explorerLine.moves[explorerMoveIdx].fen_after)
    : null;
  const boardFen = explorerFen || currentFen;
  const boardColor = explorerFen
    ? (explorerFen.split(' ')[1] as 'w' | 'b')
    : currentColor;

  const { moves: bookMoves, inBook } = useBookMoves(boardFen);

  useEffect(() => {
    if (!ready) return;
    analyse(boardFen, boardColor, 16);
  }, [ready, boardFen, boardColor, analyse]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (explorerLine) return; // Skip game arrow keys if in explorer
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(-1, c - 1));
      else if (e.key === 'ArrowRight') setCursor((c) => Math.min(history.length - 1, c + 1));
      else if (e.key === 'ArrowUp') setCursor(-1);
      else if (e.key === 'ArrowDown') setCursor(history.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history.length, explorerLine]);

  // Keyboard navigation for explorer line
  useEffect(() => {
    if (!explorerLine) return;
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (explorerMoveIdx > -1) {
          const nextIdx = explorerMoveIdx - 1;
          setExplorerMoveIdx(nextIdx);
          playMoveSound(false);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (explorerMoveIdx < explorerLine.moves.length - 1) {
          const nextIdx = explorerMoveIdx + 1;
          setExplorerMoveIdx(nextIdx);
          const nextMove = explorerLine.moves[nextIdx];
          playMoveSound(nextMove.san.includes('x'));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [explorerLine, explorerMoveIdx]);

  const prevCursorRef = useRef(cursor);
  const prevHistoryRef = useRef(history);

  useEffect(() => {
    if (prevHistoryRef.current !== history) {
      prevHistoryRef.current = history;
      prevCursorRef.current = cursor;
      return;
    }

    if (prevCursorRef.current !== cursor) {
      const direction = cursor - prevCursorRef.current;
      prevCursorRef.current = cursor;

      if (history.length > 0 && cursor >= -1) {
        if (direction > 0 && cursor >= 0 && history[cursor]) {
          const isCapture = history[cursor].san.includes('x');
          playMoveSound(isCapture);
        } else if (direction < 0) {
          playMoveSound(false);
        }
      }
    }
  }, [cursor, history]);

  useEffect(() => {
    if (!analyzing && activeGame?.id && history.length > 0) {
      fetch('/api/puzzles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: activeGame.id }),
      }).catch(console.error);
    }
  }, [analyzing, activeGame?.id, history.length]);

  useEffect(() => {
    if (!activeGame?.id) {
      setRelevantBookLine(null);
      return;
    }
    fetch(`/api/book-line-for-game?gameId=${activeGame.id}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.bookLine) {
          setRelevantBookLine(data.bookLine);
        } else {
          setRelevantBookLine(null);
        }
      })
      .catch(() => setRelevantBookLine(null));
  }, [activeGame?.id]);

  // Interactive piece drop
  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare, piece }: any) => {
      setExplorerLine(null);
      const promo = getPromotionPiece(piece.pieceType, targetSquare);
      const entry = executeMove(currentFen, sourceSquare, targetSquare, promo);
      if (!entry) return false;
      updateHistoryAndCursor(entry, cursor, setHistory, setCursor, analyzeLastMove, initialFen);
      return true;
    },
    [currentFen, cursor, analyzeLastMove, initialFen]
  );

  const playUciMove = useCallback((uci: string) => {
    setExplorerLine(null);
    const chess = new Chess(currentFen), m = tryMakeMove(chess, uci);
    if (!m) return;
    const next = [...history.slice(0, cursor + 1), { fen: chess.fen(), san: m.san, to: m.to }];
    setHistory(next);
    setCursor(next.length - 1);
    setTimeout(() => analyzeLastMove(next, initialFen), 0);
  }, [currentFen, cursor, history, analyzeLastMove, initialFen]);

  const loadRawPgn = useCallback((pgn: string, id?: number) => {
    const { sf, entries } = parsePgn(pgn);
    setInitialFen(sf);
    setHistory(entries);
    setCursor(-1);
    resetAnalysis();
    analyzeGame(entries, sf);
    saveGamePgn(pgn, setActiveGame);
    setupGameMeta(pgn, setOrientation, setActiveGame, id);
  }, [analyzeGame, resetAnalysis]);

  const loadGameFromPuzzle = useCallback((pgn: string, startFen: string, id?: number) => {
    const { sf, entries } = parsePgn(pgn);
    setInitialFen(sf);
    setHistory(entries);
    resetAnalysis();
    analyzeGame(entries, sf);
    setupGameMeta(pgn, setOrientation, setActiveGame, id);
    
    const target = normalizeBookFen(startFen);
    let targetCursor = -1;
    if (normalizeBookFen(sf) === target) {
      targetCursor = -1;
    } else {
      const idx = entries.findIndex(e => normalizeBookFen(e.fen) === target);
      if (idx !== -1) {
        targetCursor = idx;
      }
    }
    setCursor(targetCursor);
    setMode('analysis');
  }, [analyzeGame, resetAnalysis]);

  // PGN load
  const loadPgn = useCallback(() => {
    try {
      loadRawPgn(pgnInput);
      setPgnError('');
      setShowPgnPanel(false);
      setPgnInput('');
    } catch { setPgnError('Invalid PGN — check the format and try again.'); }
  }, [pgnInput, loadRawPgn]);

  const enterVariation = useCallback((line: any) => {
    if (baseState) return;
    setBaseState({ history, cursor });
    const newEntries = buildVariationEntries(currentFen, line.pv);
    setHistory([...history.slice(0, cursor + 1), ...newEntries]);
    setCursor(cursor + 1);
  }, [baseState, history, cursor, currentFen]);

  const exitVariation = useCallback(() => {
    if (!baseState) return;
    setHistory(baseState.history);
    setCursor(baseState.cursor);
    setBaseState(null);
  }, [baseState]);

  // Arrows
  const arrowMap = new Map<string, Arrow>();
  if (evaluation.bestMove && evaluation.bestMove.length >= 4) {
    const key = `${evaluation.bestMove.slice(0, 2)}-${evaluation.bestMove.slice(2, 4)}`;
    arrowMap.set(key, {
      startSquare: evaluation.bestMove.slice(0, 2),
      endSquare: evaluation.bestMove.slice(2, 4),
      color: 'rgba(0,200,100,0.8)',
    });
  }
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
  const arrows: Arrow[] = Array.from(arrowMap.values());

  // Board annotation overlay — show icon on the destination square of the current move
  const annotationSquare = cursor >= 0 ? history[cursor]?.to : null;
  const currentAnnotation = cursor >= 0 ? annotations[cursor] : null;

  const squareRenderer = useCallback(
    ({ square, children }: any) => {
      const show = square === annotationSquare && currentAnnotation?.types.length;
      return (
        <div className="relative w-full h-full">
          {children}
          {show && <SquareAnnotations types={currentAnnotation.types} />}
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

  const bookLineActiveIdx = (() => {
    if (!relevantBookLine) return -2;
    const normBoard = normalizeBookFen(boardFen);
    if (normBoard === normalizeBookFen(relevantBookLine.start_fen || STARTING_FEN)) {
      return -1;
    }
    const moves = relevantBookLine.moves || [];
    for (let i = 0; i < moves.length; i++) {
      if (normalizeBookFen(moves[i].fen_after) === normBoard) {
        return i;
      }
    }
    return -2;
  })();

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
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-900/60 text-blue-300 border border-blue-700 font-medium">
              📖 in book
            </span>
          )}
          {relevantBookLine && (
            <button 
              onClick={() => {
                setExplorerLine(relevantBookLine);
                setExplorerMoveIdx(-1);
              }}
              className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-800 hover:bg-blue-955/40 border border-zinc-700 hover:border-blue-900 text-zinc-300 hover:text-blue-300 transition-all cursor-pointer font-medium"
              title="Open opening line explorer"
            >
              📖 Explore Opening: {relevantBookLine.name}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {history.length > 0 && (
            analyzing ? (
              <span className="text-xs px-3 py-1 rounded bg-yellow-900/50 text-yellow-300 border border-yellow-800">
                Analyzing… {progress}%
              </span>
            ) : annotations.length > 0 ? (
              <button onClick={() => analyzeGame(history, initialFen)}
                className="text-xs px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">
                Re-analyze
              </button>
            ) : null
          )}
          <button onClick={() => setMode('puzzles')}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer">
            🧩 Puzzles
          </button>
          <button onClick={() => setShowLibrary(true)}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer">
            📚 Library
          </button>
          <button onClick={() => setShowPgnPanel((v) => !v)}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
            {showPgnPanel ? 'Close PGN' : 'Import PGN'}
          </button>
          <button onClick={() => setOrientation((o) => o === 'white' ? 'black' : 'white')}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
            Flip ⇅
          </button>
          <button onClick={() => { setHistory([]); setCursor(-1); resetAnalysis(); setInitialFen(STARTING_FEN); setActiveGame(null); setMode('analysis'); }}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
            Reset
          </button>
        </div>
      </header>
      {activeGame && (
        <ActiveGameHeader 
          game={activeGame} 
          relevantBookLine={relevantBookLine}
          onExploreBookLine={() => {
            setExplorerLine(relevantBookLine);
            setExplorerMoveIdx(-1);
          }}
          onClear={() => { 
            setHistory([]); 
            setCursor(-1); 
            resetAnalysis(); 
            setInitialFen(STARTING_FEN); 
            setActiveGame(null); 
          }} 
        />
      )}

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
      {mode === 'puzzles' ? (
        <PuzzleArena onExit={() => setMode('analysis')} onLoadGame={loadGameFromPuzzle} />
      ) : (
        <div className="flex flex-1 overflow-hidden">
        {/* Eval bar */}
        <div className="flex items-stretch px-2 py-2 shrink-0">
          <EvalBar evaluation={evaluation} orientation={orientation} />
        </div>

        {/* Board */}
        <div className="flex flex-col items-center justify-center flex-1 p-2 gap-4">
          <div className="relative aspect-square" style={{ width: 'min(calc(100vh - 280px), calc(100vw - 560px))' }}>
            <ChessboardProvider
              options={{
                position: boardFen,
                boardOrientation: orientation,
                arrows: [],
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
            <CustomBoardArrows arrows={arrows} orientation={orientation} />
          </div>
          <div className="w-full overflow-visible" style={{ maxWidth: 'min(calc(100vh - 280px), calc(100vw - 560px))' }}>
            <GameGraph annotations={annotations} currentIndex={cursor} onSelect={(i) => { setCursor(i); setExplorerLine(null); }} />
          </div>
        </div>

        {/* Right panel */}
        <div className="w-[500px] flex flex-col border-l border-zinc-800 shrink-0">
          {baseState && (
            <div className="bg-blue-950/40 border-b border-blue-900/60 p-2.5 text-center flex flex-col gap-1.5 shrink-0 select-none">
              <span className="text-xs text-blue-300 font-semibold flex items-center justify-center gap-1">🔍 Viewing Variation Line</span>
              <button onClick={exitVariation}
                className="text-xs py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors cursor-pointer w-full">
                Back to Game
              </button>
            </div>
          )}

          {/* Eval summary */}
          <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-bold tabular-nums">{evalLabel()}</span>
              <span className="text-xs text-zinc-500">depth {evaluation.depth}</span>
            </div>
            <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {evaluation.lines && evaluation.lines.length > 0 ? (
                evaluation.lines.slice(0, 4).map((line, idx) => (
                  <EngineLineRow key={idx} line={line} startFen={boardFen} userColor={orientation === 'white' ? 'w' : 'b'} onClick={() => enterVariation(line)} />
                ))
              ) : (
                evaluation.pv.length > 0 && (
                  <p className="text-xs text-zinc-400 break-words font-mono leading-normal">
                    {pvToSan(boardFen, evaluation.pv).join(' ')}
                  </p>
                )
              )}
            </div>
          </div>

          {/* Book Line Explorer */}
          {relevantBookLine && (
            <div className="px-3 py-3 border-b border-zinc-800 bg-zinc-900 shrink-0 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">Book Line Explorer</span>
                {explorerLine && (
                  <button 
                    onClick={() => setExplorerLine(null)}
                    className="text-[10px] px-2 py-0.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 rounded font-semibold border border-zinc-700 transition-colors cursor-pointer"
                  >
                    Exit Explorer
                  </button>
                )}
              </div>
              <div className="space-y-1.5">
                <div 
                  onClick={() => {
                    if (!explorerLine) {
                      setExplorerLine(relevantBookLine);
                      setExplorerMoveIdx(-1);
                    }
                  }}
                  className={`text-xs font-semibold truncate transition-colors cursor-pointer ${explorerLine ? 'text-blue-300 font-bold' : 'text-zinc-300 hover:text-zinc-100'}`} 
                  title={relevantBookLine.name}
                >
                  📖 {relevantBookLine.name} {explorerLine && <span className="text-[9px] px-1 py-0.2 rounded bg-blue-950/80 border border-blue-900 text-blue-400 font-bold ml-1 uppercase tracking-wider">Active</span>}
                </div>
                <div className="flex flex-wrap gap-1">
                  <button 
                    onClick={() => {
                      playMoveSound(false);
                      setExplorerLine(relevantBookLine);
                      setExplorerMoveIdx(-1);
                    }}
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${bookLineActiveIdx === -1 ? 'bg-zinc-850 border-zinc-700 text-zinc-100 font-bold' : 'bg-zinc-950 border-zinc-900 text-zinc-500 hover:text-zinc-350'}`}
                  >
                    Start
                  </button>
                  {relevantBookLine.moves.map((move: any, moveIdx: number) => {
                    const isCurrentMove = bookLineActiveIdx === moveIdx;
                    return (
                      <button
                        key={moveIdx}
                        onClick={() => {
                          playMoveSound(move.san.includes('x'));
                          setExplorerLine(relevantBookLine);
                          setExplorerMoveIdx(moveIdx);
                        }}
                        className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${isCurrentMove ? 'bg-blue-900/60 border-blue-700 text-blue-100 font-bold' : 'bg-zinc-950 border-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                      >
                        {move.san}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

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

          {/* Db Explorer */}
          <DbExplorer fen={boardFen} onSelectMove={playUciMove} />

          {/* Move list */}
          <div className="flex-1 overflow-hidden">
            <MoveList
              sanMoves={history.map((h) => h.san)}
              currentIndex={cursor}
              annotations={annotations}
              onSelect={(i) => { setCursor(i); setExplorerLine(null); }}
              variationStart={baseState ? baseState.cursor : -1}
            />
          </div>

          {/* Navigation */}
          <div className="flex gap-1 px-2 py-2 border-t border-zinc-800 shrink-0">
            {[
              { label: '⏮', action: () => { setCursor(-1); setExplorerLine(null); }, title: 'Start' },
              { label: '◀', action: () => { setCursor((c) => Math.max(-1, c - 1)); setExplorerLine(null); }, title: 'Prev (←)' },
              { label: '▶', action: () => { setCursor((c) => Math.min(history.length - 1, c + 1)); setExplorerLine(null); }, title: 'Next (→)' },
              { label: '⏭', action: () => { setCursor(history.length - 1); setExplorerLine(null); }, title: 'End' },
            ].map(({ label, action, title }) => (
              <button key={label} onClick={action} title={title}
                className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors">
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      )}
      <GameLibrary isOpen={showLibrary} onClose={() => setShowLibrary(false)} onSelectGame={loadRawPgn} />
    </div>
  );
}

function getSquareCoords(square: string, orientation: 'white' | 'black') {
  const colIndex = square.charCodeAt(0) - 97;
  const rowIndex = parseInt(square[1]) - 1;
  const x = orientation === 'white' ? (colIndex + 0.5) * 12.5 : (7 - colIndex + 0.5) * 12.5;
  const y = orientation === 'white' ? (7 - rowIndex + 0.5) * 12.5 : (rowIndex + 0.5) * 12.5;
  return { x, y };
}

function getArrowheadPoints(bx: number, by: number, tx: number, ty: number, theta: number) {
  const width = 5.0;
  const lx = bx + (width / 2) * Math.cos(theta + Math.PI / 2);
  const ly = by + (width / 2) * Math.sin(theta + Math.PI / 2);
  const rx = bx + (width / 2) * Math.cos(theta - Math.PI / 2);
  const ry = by + (width / 2) * Math.sin(theta - Math.PI / 2);
  return `${tx},${ty} ${lx},${ly} ${rx},${ry}`;
}

function parseColorOpacity(color: string) {
  const match = color.match(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/);
  if (match) {
    return {
      solidColor: `rgb(${match[1]}, ${match[2]}, ${match[3]})`,
      opacity: parseFloat(match[4]),
    };
  }
  return { solidColor: color, opacity: 1 };
}

function getKnightArrow(from: { x: number; y: number }, to: { x: number; y: number }, dx: number, dy: number) {
  const corner = Math.abs(dx) < Math.abs(dy) ? { x: from.x, y: to.y } : { x: to.x, y: from.y };
  const theta = Math.atan2(to.y - corner.y, to.x - corner.x);
  const bx = to.x - 5.0 * Math.cos(theta), by = to.y - 5.0 * Math.sin(theta);
  return { pathD: `M ${from.x} ${from.y} L ${corner.x} ${corner.y} L ${bx} ${by}`, theta, bx, by, tx: to.x, ty: to.y };
}

function getStraightArrow(from: { x: number; y: number }, to: { x: number; y: number }, dx: number, dy: number) {
  const theta = Math.atan2(dy, dx);
  const bx = to.x - 5.0 * Math.cos(theta), by = to.y - 5.0 * Math.sin(theta);
  return { pathD: `M ${from.x} ${from.y} L ${bx} ${by}`, theta, bx, by, tx: to.x, ty: to.y };
}

function getArrowData(arrow: Arrow, orientation: 'white' | 'black') {
  const from = getSquareCoords(arrow.startSquare, orientation);
  const to = getSquareCoords(arrow.endSquare, orientation);
  const dx = to.x - from.x, dy = to.y - from.y;
  const isKnight = Math.abs(Math.round(dx / 12.5) * Math.round(dy / 12.5)) === 2;
  return isKnight ? getKnightArrow(from, to, dx, dy) : getStraightArrow(from, to, dx, dy);
}

const ArrowGroup = ({ arrow, orientation }: { arrow: Arrow; orientation: 'white' | 'black' }) => {
  const d = getArrowData(arrow, orientation);
  const p = getArrowheadPoints(d.bx, d.by, d.tx, d.ty, d.theta);
  const { solidColor, opacity } = parseColorOpacity(arrow.color);
  return (
    <g style={{ opacity }}>
      <path d={d.pathD} fill="none" stroke={solidColor} strokeWidth="2.5" strokeLinecap="round" />
      <polygon points={p} fill={solidColor} />
    </g>
  );
};

function CustomBoardArrows({ arrows, orientation }: { arrows: Arrow[]; orientation: 'white' | 'black' }) {
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 pointer-events-none z-20">
      {arrows.map((a, i) => <ArrowGroup key={i} arrow={a} orientation={orientation} />)}
    </svg>
  );
}

function tryMakeMove(chess: Chess, uci: string) {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  } catch {
    return null;
  }
}

function parsePgn(pgn: string) {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const sf = chess.header().FEN || chess.header().Fen || STARTING_FEN;
  const replay = sf !== STARTING_FEN ? new Chess(sf) : new Chess();
  const entries = chess.history({ verbose: true }).map((m) => {
    replay.move(m.san);
    return { fen: replay.fen(), san: m.san, to: m.to };
  });
  return { sf, entries };
}

function saveGamePgn(pgn: string, setActiveGame: any) {
  fetch('/api/games', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pgn }) })
    .then((r) => r.json())
    .then((d) => d.id && setActiveGame((g: any) => g ? { ...g, id: d.id } : null))
    .catch(console.error);
}

function parseGameMeta(pgn: string): GameMeta {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const h = chess.header();
  const white = h.White || 'Unknown', black = h.Black || 'Unknown';
  return { white, black, result: h.Result || '*', date: h.Date || 'Unknown' };
}

function setupGameMeta(pgn: string, setOrientation: any, setActiveGame: any, id?: number) {
  setOrientation(getPlayerOrientation(pgn));
  setActiveGame({ ...parseGameMeta(pgn), id });
}

function getPlayerOrientation(pgn: string): 'white' | 'black' {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const headers = chess.header();
  const white = (headers['White'] ?? '').toLowerCase();
  const black = (headers['Black'] ?? '').toLowerCase();
  return black.includes('demanzonderjas') ? 'black' : 'white';
}

function buildVariationEntries(startFen: string, pv: string[]): HistoryEntry[] {
  const chess = new Chess(startFen);
  const entries: HistoryEntry[] = [];
  for (const m of pv) {
    const move = tryMakeMove(chess, m);
    if (!move) break;
    entries.push({ fen: chess.fen(), san: move.san, to: move.to });
  }
  return entries;
}

function pvToSan(startFen: string, pv: string[]): string[] {
  try {
    const chess = new Chess(startFen);
    return pv.slice(0, 16).map((m) => chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] })?.san || m);
  } catch {
    return pv.slice(0, 16);
  }
}

function formatLineScore(line: any): string {
  if (line.mate !== null) return `M${Math.abs(line.mate)}`;
  if (line.score === null) return '0.00';
  const cp = line.score / 100;
  return (cp >= 0 ? '+' : '') + cp.toFixed(2);
}

const SacrificeBadge = () => (
  <span className="px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/35 text-[9px] font-bold select-none leading-none shrink-0" title="Material Sacrifice">
    🔥 SAC
  </span>
);

const EngineLineRow = ({ line, startFen, userColor, onClick }: any) => (
  <div onClick={onClick} className="flex items-start gap-1.5 text-xs font-mono py-1.5 border-b border-zinc-900 last:border-0 hover:bg-zinc-900/60 rounded px-1.5 cursor-pointer transition-colors">
    <span className="text-zinc-500 w-3 shrink-0">{line.multipv}.</span>
    <span className="font-bold text-zinc-200 w-11 text-right shrink-0">{formatLineScore(line)}</span>
    {line.hasSacrifice && startFen.split(' ')[1] === userColor && <SacrificeBadge />}
    <span className="text-zinc-400 flex-1 leading-normal break-words">{pvToSan(startFen, line.pv).join(' ')}</span>
  </div>
);

function getPromotionPiece(pieceType: string, targetSquare: string): string | undefined {
  const isPawn = pieceType.toLowerCase().endsWith('p');
  const isPromoRank = targetSquare[1] === '8' || targetSquare[1] === '1';
  return isPawn && isPromoRank ? 'q' : undefined;
}

function executeMove(fen: string, from: string, to: string, promo?: string) {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from, to, promotion: promo });
    return m ? { fen: chess.fen(), san: m.san, to: m.to } : null;
  } catch {
    return null;
  }
}

function updateHistoryAndCursor(entry: HistoryEntry, cursor: number, setHistory: any, setCursor: any, analyzeLastMove: any, initialFen: string) {
  setHistory((prev: HistoryEntry[]) => {
    const next = [...prev.slice(0, cursor + 1), entry];
    setTimeout(() => analyzeLastMove(next, initialFen), 0);
    return next;
  });
  setCursor((c: number) => c + 1);
}

const AnnotationBadge = ({ type }: { type: string }) => {
  const icon = ANNOTATION_ICONS[type];
  if (!icon) return null;
  const size = type === 'book' ? 'w-14 h-14 text-3xl' : 'w-12 h-12 text-2xl';
  return (
    <span className={`flex items-center justify-center rounded-full border-[3px] border-white shadow-[0_4px_8px_rgba(0,0,0,0.5)] font-bold leading-none ${size}`} style={{ backgroundColor: icon.bg, color: icon.text }}>{icon.symbol}</span>
  );
};

const SquareAnnotations = ({ types }: { types: string[] }) => (
  <div className="absolute top-[3px] right-[3px] z-20 flex gap-[3px] pointer-events-none">
    {types.map((t) => <AnnotationBadge key={t} type={t} />)}
  </div>
);

function normalizeBookFen(fen: string): string {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}
