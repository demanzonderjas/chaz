'use client';

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
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
import { GamePuzzleArena } from './GamePuzzleArena';
import { playMoveSound, playErrorSound } from '../services/sound';
import { preprocessPgn, isUserBlack } from '../services/pgn';


type Arrow = { startSquare: string; endSquare: string; color: string };

const ANNOTATION_ICONS: Record<string, { symbol: string; bg: string; text: string }> = {
  book:        { symbol: '📖',   bg: '#2563eb', text: '#ffffff' },
  brilliant:   { symbol: '!!',   bg: '#0d9488', text: '#ffffff' },
  mistake:     { symbol: '?',    bg: '#ea580c', text: '#ffffff' },
  blunder:     { symbol: '??',   bg: '#dc2626', text: '#ffffff' },
  missed_book: { symbol: '📖?',  bg: '#f59e0b', text: '#ffffff' },
};

interface GameMeta {
  white: string;
  black: string;
  result: string;
  date: string;
  whiteElo?: number | null;
  blackElo?: number | null;
}

function getResultStyle(res: string) {
  if (res === '1-0') return 'bg-emerald-950/60 text-emerald-400 border border-emerald-800';
  if (res === '0-1') return 'bg-rose-950/60 text-rose-400 border border-rose-800';
  return 'bg-zinc-800 text-zinc-400 border border-zinc-700';
}

function areArrowsEqual(a: Arrow[], b: Arrow[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].startSquare !== b[i].startSquare || a[i].endSquare !== b[i].endSquare) {
      return false;
    }
  }
  return true;
}


const ActiveGameHeader = ({ game, onClear, relevantBookLine, onExploreBookLine }: any) => (
  <div className="flex items-center justify-between px-6 py-2.5 bg-zinc-900/60 border-b border-zinc-800 backdrop-blur-md shrink-0">
    <div className="flex items-center gap-4 flex-wrap">
      <span className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
        ⚪ {game.white}{game.whiteElo ? ` (${game.whiteElo})` : ''}{' '}
        <span className="text-zinc-500 font-light">vs</span>{' '}
        ⚫ {game.black}{game.blackElo ? ` (${game.blackElo})` : ''}
      </span>
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
  const [mode, setMode] = useState<'analysis' | 'puzzles' | 'game-puzzles' | 'book-explorer'>('analysis');
  const [gameMistakes, setGameMistakes] = useState<any[]>([]);
  const [loadingGameMistakes, setLoadingGameMistakes] = useState(false);
  const [orientation, setOrientation] = useState<'white' | 'black'>('white');
  const [pgnInput, setPgnInput] = useState('');
  const [pgnError, setPgnError] = useState('');
  const [showPgnPanel, setShowPgnPanel] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [baseState, setBaseState] = useState<{ history: HistoryEntry[]; cursor: number; initialFen?: string; previousMode?: 'analysis' | 'book-explorer' } | null>(null);
  const [hoveredBook, setHoveredBook] = useState<string | null>(null);
  const [relevantBookLine, setRelevantBookLine] = useState<any | null>(null);
  const [explorerLine, setExplorerLine] = useState<any | null>(null);
  const [explorerMoveIdx, setExplorerMoveIdx] = useState<number>(-1);

  // Book explorer specific states
  const [groupedOpenings, setGroupedOpenings] = useState<any[]>([]);
  const [loadingBookLines, setLoadingBookLines] = useState<boolean>(false);
  const [activeBookLine, setActiveBookLine] = useState<any | null>(null);
  const [activeBookMoveIdx, setActiveBookMoveIdx] = useState<number>(-1);
  const [activeBookNote, setActiveBookNote] = useState<string>('');
  const [loadedArrows, setLoadedArrows] = useState<Arrow[]>([]);
  const [drawnArrows, setDrawnArrows] = useState<Arrow[]>([]);
  const [boardKey, setBoardKey] = useState<number>(0);
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);
  const [saveNoteSuccess, setSaveNoteSuccess] = useState<boolean>(false);
  const [bookLinesSearch, setBookLinesSearch] = useState<string>('');
  const [bookLinesColor, setBookLinesColor] = useState<'all' | 'w' | 'b'>('all');
  const [expandedOpenings, setExpandedOpenings] = useState<Record<number | string, boolean>>({});
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);

  // Quiz Mode states
  const [quizMode, setQuizMode] = useState<'study' | 'quiz' | 'review'>('quiz');
  const [solvedMoveIdx, setSolvedMoveIdx] = useState<number>(-1);
  const [quizMistakes, setQuizMistakes] = useState<number[]>([]);
  const [reviewQueue, setReviewQueue] = useState<{ moveIdx: number; count: number }[]>([]);
  const [currentReviewIdx, setCurrentReviewIdx] = useState<number>(0);
  const [quizStatus, setQuizStatus] = useState<'playing' | 'completed' | 'reviewing'>('playing');
  const [quizFeedback, setQuizFeedback] = useState<{ type: 'success' | 'error'; text: string; square?: string } | null>(null);
  const [quizStartFen, setQuizStartFen] = useState<string | null>(null);
  const [isTempSubgroupActive, setIsTempSubgroupActive] = useState<boolean>(false);
  const [tempWrongFen, setTempWrongFen] = useState<string | null>(null);

  // Clear quiz feedback after 1.2 seconds
  useEffect(() => {
    if (!quizFeedback) return;
    const timer = setTimeout(() => {
      setQuizFeedback(null);
    }, 1200);
    return () => clearTimeout(timer);
  }, [quizFeedback]);

  // Opponent Auto-play logic (Computer moves)
  useEffect(() => {
    if (mode !== 'book-explorer' || quizMode !== 'quiz' || !activeBookLine || quizStatus !== 'playing') return;

    const nextIdx = solvedMoveIdx + 1;
    if (nextIdx >= activeBookLine.moves.length) {
      setQuizStatus('completed');
      return;
    }

    const nextMove = activeBookLine.moves[nextIdx];
    const isPlayerWhite = activeBookLine.color === 'w';
    const isNextMoveWhite = nextMove.ply % 2 === 1;
    const isComputerTurn = (isPlayerWhite && !isNextMoveWhite) || (!isPlayerWhite && isNextMoveWhite);

    if (isComputerTurn) {
      const timer = setTimeout(() => {
        setActiveBookMoveIdx(nextIdx);
        setSolvedMoveIdx(nextIdx);
        playMoveSound(nextMove.san.includes('x'));
        
        if (nextIdx + 1 >= activeBookLine.moves.length) {
          setQuizStatus('completed');
        }
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [mode, quizMode, activeBookLine?.id, solvedMoveIdx, quizStatus]);

  const isMoveVisible = useCallback((moveIdx: number) => {
    if (quizMode === 'study') return true;
    if (quizMode === 'quiz') return moveIdx <= solvedMoveIdx;
    if (quizMode === 'review') {
      if (reviewQueue.length === 0) return true;
      return moveIdx < reviewQueue[currentReviewIdx].moveIdx;
    }
    return false;
  }, [quizMode, solvedMoveIdx, reviewQueue, currentReviewIdx]);

  const { ready, evaluation, analyse } = useStockfish();
  const { annotations, analyzing, progress, analysisDepth, analyzeGame, analyzeLastMove, reset: resetAnalysis } = useGameAnalysis();

  const currentFen = (cursor < 0 || !history[cursor]) ? initialFen : history[cursor].fen;
  const currentColor = (cursor < 0 ? 'w' : cursor % 2 === 0 ? 'b' : 'w') as 'w' | 'b';

  const isBookExplorer = mode === 'book-explorer';
  const explorerFen = explorerLine 
    ? (explorerMoveIdx === -1 ? explorerLine.start_fen : explorerLine.moves[explorerMoveIdx].fen_after)
    : isBookExplorer && activeBookLine
      ? (activeBookMoveIdx === -1 ? activeBookLine.start_fen || STARTING_FEN : activeBookLine.moves[activeBookMoveIdx].fen_after)
      : null;
  const boardFen = explorerFen || currentFen;
  const boardColor = explorerFen
    ? (explorerFen.split(' ')[1] as 'w' | 'b')
    : currentColor;

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

  const { moves: bookMoves, inBook } = useBookMoves(boardFen);

  const activeLineIndexAndParent = useMemo(() => {
    if (!activeBookLine || groupedOpenings.length === 0) return null;
    for (const op of groupedOpenings) {
      const idx = op.lines.findIndex((l: any) => l.id === activeBookLine.id);
      if (idx !== -1) {
        return {
          parentOpening: op,
          index: idx,
          hasPrev: idx > 0,
          hasNext: idx < op.lines.length - 1
        };
      }
    }
    return null;
  }, [activeBookLine?.id, groupedOpenings]);

  useEffect(() => {
    if (!ready || analyzing) return;
    analyse(boardFen, boardColor, 16);
  }, [ready, boardFen, boardColor, analyse, analyzing]);

  // Keyboard navigation
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (explorerLine || mode !== 'analysis') return;
      if (e.key === 'ArrowLeft') setCursor((c) => Math.max(-1, c - 1));
      else if (e.key === 'ArrowRight') setCursor((c) => Math.min(history.length - 1, c + 1));
      else if (e.key === 'ArrowUp') setCursor(-1);
      else if (e.key === 'ArrowDown') setCursor(history.length - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history.length, explorerLine, mode]);

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

  // Book explorer side-effects and helper functions
  useEffect(() => {
    if (mode === 'book-explorer' && groupedOpenings.length === 0) {
      setLoadingBookLines(true);
      fetch('/api/book-lines')
        .then(res => res.json())
        .then(data => {
          if (data.openings) {
            setGroupedOpenings(data.openings);
          }
        })
        .catch(err => console.error('Error fetching book lines:', err))
        .finally(() => setLoadingBookLines(false));
    }
  }, [mode, groupedOpenings.length]);

  useEffect(() => {
    if (activeBookLine && activeBookMoveIdx >= 0) {
      const activeMove = activeBookLine.moves[activeBookMoveIdx];
      setActiveBookNote(activeMove.comment || '');
      if (activeMove.arrows) {
        try {
          const parsed = JSON.parse(activeMove.arrows);
          const loaded = parsed.map((a: any) => {
            if (Array.isArray(a)) {
              return { startSquare: a[0], endSquare: a[1], color: a[2] || 'rgba(168,85,247,0.85)' };
            }
            return {
              startSquare: a.startSquare,
              endSquare: a.endSquare,
              color: a.color || 'rgba(168,85,247,0.85)'
            };
          });
          setLoadedArrows(loaded);
        } catch {
          setLoadedArrows([]);
        }
      } else {
        setLoadedArrows([]);
      }
    } else {
      setActiveBookNote('');
      setLoadedArrows([]);
    }
    setDrawnArrows([]);
    setSaveNoteSuccess(false);
    setTempWrongFen(null);
  }, [activeBookLine?.id, activeBookMoveIdx]);

  const autoSaveAnalysisArrows = async (newDrawn: Arrow[]) => {
    try {
      const combined = [...loadedArrows, ...newDrawn];
      await fetch('/api/book-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fen: boardFen,
          comment: activeBookNote,
          arrows: combined
        })
      });
      // Sync relevantBookLine in memory!
      if (relevantBookLine && bookLineActiveIdx >= 0) {
        const updatedMoves = relevantBookLine.moves.map((m: any, idx: number) => {
          if (idx === bookLineActiveIdx) {
            return {
              ...m,
              arrows: combined.length > 0 ? JSON.stringify(combined) : null
            };
          }
          return m;
        });
        setRelevantBookLine({ ...relevantBookLine, moves: updatedMoves });
      }
    } catch (err) {
      console.error('Error auto-saving analysis arrows:', err);
    }
  };

  const autoSaveArrows = async (newDrawn: Arrow[]) => {
    if (!activeBookLine || activeBookMoveIdx < 0) return;
    try {
      const activeMove = activeBookLine.moves[activeBookMoveIdx];
      const combined = [...loadedArrows, ...newDrawn];
      
      const updatedMoves = activeBookLine.moves.map((m: any, idx: number) => {
        if (idx === activeBookMoveIdx) {
          return {
            ...m,
            arrows: combined.length > 0 ? JSON.stringify(combined) : null
          };
        }
        return m;
      });
      setActiveBookLine({ ...activeBookLine, moves: updatedMoves });

      await fetch('/api/book-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: activeBookLine.id,
          ply: activeMove.ply,
          comment: activeBookNote,
          arrows: combined
        })
      });
    } catch (err) {
      console.error('Error auto-saving arrows:', err);
    }
  };

  const handleSaveNote = async () => {
    if (!activeBookLine || activeBookMoveIdx < 0) return;
    setIsSavingNote(true);
    try {
      const activeMove = activeBookLine.moves[activeBookMoveIdx];
      const combined = [...loadedArrows, ...drawnArrows];
      const res = await fetch('/api/book-lines', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lineId: activeBookLine.id,
          ply: activeMove.ply,
          comment: activeBookNote,
          arrows: combined
        })
      });
      if (res.ok) {
        const updatedMoves = activeBookLine.moves.map((m: any, idx: number) => {
          if (idx === activeBookMoveIdx) {
            return {
              ...m,
              comment: activeBookNote,
              arrows: combined.length > 0 ? JSON.stringify(combined) : null
            };
          }
          return m;
        });
        setActiveBookLine({ ...activeBookLine, moves: updatedMoves });
        setSaveNoteSuccess(true);
      }
    } catch (err) {
      console.error('Error saving note:', err);
    } finally {
      setIsSavingNote(false);
    }
  };

  const loadBookLineDetail = async (lineId: number) => {
    setLoadingDetailId(lineId);
    try {
      const res = await fetch(`/api/book-lines?id=${lineId}`);
      if (res.ok) {
        const data = await res.json();
        if (data.line && data.moves) {
          setActiveBookLine({
            id: data.line.id,
            name: data.line.name,
            color: data.line.color,
            notes: data.line.notes,
            moves: data.moves
          });
          
          let startIdx = -1;
          if (quizStartFen) {
            const normStart = normalizeBookFen(quizStartFen);
            const matchIdx = data.moves.findIndex((m: any) => normalizeBookFen(m.fen_before) === normStart);
            if (matchIdx !== -1) {
              startIdx = matchIdx - 1;
            }
          }
          setActiveBookMoveIdx(startIdx);
          setOrientation(data.line.color === 'b' ? 'black' : 'white');
          // Reset Quiz States
          setQuizMode('quiz');
          setSolvedMoveIdx(startIdx);
          setQuizMistakes([]);
          setReviewQueue([]);
          setCurrentReviewIdx(0);
          setQuizStatus('playing');
          setQuizFeedback(null);
          // Unload Game States
          setActiveGame(null);
          setGameMistakes([]);
          setRelevantBookLine(null);
          setBaseState(null);
          setExplorerLine(null);
          setExplorerMoveIdx(-1);
        }
      }
    } catch (err) {
      console.error('Error loading book line detail:', err);
    } finally {
      setLoadingDetailId(null);
    }
  };

  useEffect(() => {
    if (mode !== 'book-explorer' || !activeBookLine) return;
    const onKey = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (activeBookMoveIdx > -1) {
          const nextIdx = activeBookMoveIdx - 1;
          setActiveBookMoveIdx(nextIdx);
          playMoveSound(false);
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const maxAllowedIdx = quizMode === 'study' 
          ? activeBookLine.moves.length - 1 
          : quizMode === 'review'
            ? (reviewQueue.length > 0 ? reviewQueue[currentReviewIdx].moveIdx - 1 : -1)
            : solvedMoveIdx;

        if (activeBookMoveIdx < maxAllowedIdx) {
          const nextIdx = activeBookMoveIdx + 1;
          setActiveBookMoveIdx(nextIdx);
          const nextMove = activeBookLine.moves[nextIdx];
          playMoveSound(nextMove.san.includes('x'));
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, activeBookLine, activeBookMoveIdx, quizMode, solvedMoveIdx, reviewQueue, currentReviewIdx]);

  const toggleOpeningExpanded = (opId: number | string) => {
    setExpandedOpenings(prev => ({ ...prev, [opId]: !prev[opId] }));
  };

  const practiceVariationsFromCurrentPosition = async () => {
    setLoadingBookLines(true);
    const res = await fetch(`/api/book-lines?fen=${encodeURIComponent(boardFen)}`).catch(() => null);
    setLoadingBookLines(false);
    if (res?.ok) {
      const data = await res.json();
      setGroupedOpenings(data.openings || []);
      setIsTempSubgroupActive(true);
      setQuizStartFen(boardFen);
      setExpandedOpenings({ 'temp-group': true });
      setMode('book-explorer');
      setActiveBookLine(null);
    }
  };

  const restoreAllOpenings = async () => {
    setLoadingBookLines(true);
    const res = await fetch('/api/book-lines').catch(() => null);
    setLoadingBookLines(false);
    if (res?.ok) {
      const data = await res.json();
      setGroupedOpenings(data.openings || []);
      setIsTempSubgroupActive(false);
      setQuizStartFen(null);
    }
  };

  const getFilteredAndGrouped = () => {
    const query = bookLinesSearch.trim().toLowerCase();
    return groupedOpenings.map(op => {
      const filteredLines = op.lines.filter((line: any) => {
         const matchesSearch = line.name.toLowerCase().includes(query);
         const matchesColor = bookLinesColor === 'all' || line.color === bookLinesColor;
         return matchesSearch && matchesColor;
      });
      return { ...op, lines: filteredLines };
    }).filter(op => op.lines.length > 0);
  };

  const prevCursorRef = useRef(cursor);

  const loadAndStartPractice = async () => {
    setLoadingGameMistakes(true);
    const list = await compileGameMistakes(history, annotations, orientation, initialFen).catch(() => []);
    setLoadingGameMistakes(false);
    if (list.length > 0) {
      setGameMistakes(list);
      setMode('game-puzzles');
    }
  };

  const startPracticeMode = () => {
    if (getPlayerMistakeCount(annotations, orientation) === 0) {
      alert("No mistakes were made on your end in this game! Perfect game! 🎉");
      return;
    }
    loadAndStartPractice();
  };
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

  useEffect(() => {
    if (mode !== 'analysis') return;

    // Check if we can load it from relevantBookLine in memory first
    if (relevantBookLine && bookLineActiveIdx >= 0) {
      const activeMove = relevantBookLine.moves[bookLineActiveIdx];
      setActiveBookNote(activeMove.comment || '');
      if (activeMove.arrows) {
        try {
          const parsed = JSON.parse(activeMove.arrows);
          const loaded = parsed.map((a: any) => {
            if (Array.isArray(a)) {
              return { startSquare: a[0], endSquare: a[1], color: a[2] || 'rgba(168,85,247,0.85)' };
            }
            return {
              startSquare: a.startSquare,
              endSquare: a.endSquare,
              color: a.color || 'rgba(168,85,247,0.85)'
            };
          });
          setLoadedArrows(loaded);
        } catch {
          setLoadedArrows([]);
        }
      } else {
        setLoadedArrows([]);
      }
      setDrawnArrows([]);
      setSaveNoteSuccess(false);
      return;
    }

    fetch(`/api/book-lines?positionFen=${encodeURIComponent(boardFen)}`)
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setActiveBookNote(data.comment || '');
          if (data.arrows) {
            try {
              const parsed = JSON.parse(data.arrows);
              const loaded = parsed.map((a: any) => {
                if (Array.isArray(a)) {
                  return { startSquare: a[0], endSquare: a[1], color: a[2] || 'rgba(168,85,247,0.85)' };
                }
                return {
                  startSquare: a.startSquare,
                  endSquare: a.endSquare,
                  color: a.color || 'rgba(168,85,247,0.85)'
                };
              });
              setLoadedArrows(loaded);
            } catch {
              setLoadedArrows([]);
            }
          } else {
            setLoadedArrows([]);
          }
        } else {
          setActiveBookNote('');
          setLoadedArrows([]);
        }
        setDrawnArrows([]);
        setSaveNoteSuccess(false);
      })
      .catch(() => {
        setActiveBookNote('');
        setLoadedArrows([]);
        setDrawnArrows([]);
        setSaveNoteSuccess(false);
      });
  }, [mode, boardFen, relevantBookLine, bookLineActiveIdx]);

  // Interactive piece drop
  const onPieceDrop = useCallback(
    ({ sourceSquare, targetSquare, piece }: any) => {
      if (mode === 'book-explorer') {
        if (!activeBookLine) return false;

        if (quizMode === 'study') {
          const nextIdx = activeBookMoveIdx + 1;
          if (nextIdx >= activeBookLine.moves.length) return false;
          const nextMove = activeBookLine.moves[nextIdx];
          const promo = getPromotionPiece(piece.pieceType, targetSquare);
          const userUci = `${sourceSquare}${targetSquare}${promo || ''}`;
          if (userUci === nextMove.uci) {
            setActiveBookMoveIdx(nextIdx);
            playMoveSound(nextMove.san.includes('x'));
            return true;
          }
          return false;
        }

        if (quizMode === 'quiz') {
          if (quizStatus !== 'playing') return false;
          if (activeBookMoveIdx !== solvedMoveIdx) {
            setQuizFeedback({ type: 'error', text: 'Navigate to the current position to play the move!', square: targetSquare });
            return false;
          }

          const nextIdx = activeBookMoveIdx + 1;
          if (nextIdx >= activeBookLine.moves.length) return false;
          const expectedMove = activeBookLine.moves[nextIdx];

          const promo = getPromotionPiece(piece.pieceType, targetSquare);
          const userUci = `${sourceSquare}${targetSquare}${promo || ''}`;

          // Validate legality of move
          const chess = new Chess(boardFen);
          if (!tryMakeMove(chess, userUci)) {
            return false;
          }

          if (userUci === expectedMove.uci) {
            setQuizFeedback({ type: 'success', text: 'Correct!', square: targetSquare });
            setActiveBookMoveIdx(nextIdx);
            setSolvedMoveIdx(nextIdx);
            playMoveSound(expectedMove.san.includes('x'));
            return true;
          } else {
            playErrorSound();
            setQuizFeedback({ type: 'error', text: 'Wrong!', square: targetSquare });
            if (!quizMistakes.includes(nextIdx)) {
              setQuizMistakes(prev => [...prev, nextIdx]);
              fetch('/api/puzzles/attempt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  puzzleId: null,
                  startFen: expectedMove.fen_before,
                  success: false
                })
              }).catch(console.error);
            }
            setTempWrongFen(chess.fen());
            setTimeout(() => {
              setTempWrongFen(null);
            }, 1000);
            return true;
          }
        }

        if (quizMode === 'review') {
          if (reviewQueue.length === 0) return false;
          const reviewItem = reviewQueue[currentReviewIdx];
          const expectedMove = activeBookLine.moves[reviewItem.moveIdx];

          if (activeBookMoveIdx !== reviewItem.moveIdx - 1) {
            setQuizFeedback({ type: 'error', text: 'Navigate to the review position to play!', square: targetSquare });
            return false;
          }

          const promo = getPromotionPiece(piece.pieceType, targetSquare);
          const userUci = `${sourceSquare}${targetSquare}${promo || ''}`;

          // Validate legality of move
          const chess = new Chess(boardFen);
          if (!tryMakeMove(chess, userUci)) {
            return false;
          }

          if (userUci === expectedMove.uci) {
            playMoveSound(expectedMove.san.includes('x'));
            
            // Render the played move immediately on the board
            setActiveBookMoveIdx(reviewItem.moveIdx);

            const nextCount = reviewItem.count - 1;
            if (nextCount > 0) {
              setQuizFeedback({ type: 'success', text: `Correct! Solve it ${nextCount} more time${nextCount > 1 ? 's' : ''}.`, square: targetSquare });
              setReviewQueue(prev => prev.map((item, idx) => idx === currentReviewIdx ? { ...item, count: nextCount } : item));
              setTimeout(() => {
                setActiveBookMoveIdx(reviewItem.moveIdx - 1);
              }, 1000);
            } else {
              setQuizFeedback({ type: 'success', text: 'Cleared!', square: targetSquare });
              const updatedQueue = reviewQueue.filter((_, idx) => idx !== currentReviewIdx);
              setTimeout(() => {
                setReviewQueue(updatedQueue);
                if (updatedQueue.length === 0) {
                  setQuizStatus('completed');
                } else {
                  const nextReviewIdx = currentReviewIdx >= updatedQueue.length ? 0 : currentReviewIdx;
                  setCurrentReviewIdx(nextReviewIdx);
                  setActiveBookMoveIdx(updatedQueue[nextReviewIdx].moveIdx - 1);
                }
              }, 1000);
            }
            return true;
          } else {
            playErrorSound();
            setQuizFeedback({ type: 'error', text: 'Wrong!', square: targetSquare });
            setReviewQueue(prev => prev.map((item, idx) => idx === currentReviewIdx ? { ...item, count: 2 } : item));
            fetch('/api/puzzles/attempt', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                puzzleId: null,
                startFen: expectedMove.fen_before,
                success: false
              })
            }).catch(console.error);
            setTempWrongFen(chess.fen());
            setTimeout(() => {
              setTempWrongFen(null);
            }, 1000);
            return true;
          }
        }

        return false;
      }

      setExplorerLine(null);
      const promo = getPromotionPiece(piece.pieceType, targetSquare);
      const entry = executeMove(currentFen, sourceSquare, targetSquare, promo);
      if (!entry) return false;
      if (!baseState) setBaseState({ history, cursor });
      updateHistoryAndCursor(entry, cursor, setHistory, setCursor, analyzeLastMove, initialFen, orientation);
      return true;
    },
    [
      mode, activeBookLine, quizMode, quizStatus, activeBookMoveIdx, solvedMoveIdx, quizMistakes, reviewQueue, currentReviewIdx,
      currentFen, cursor, analyzeLastMove, initialFen, baseState, history, orientation, boardFen, setTempWrongFen
    ]
  );

  const handleShowSolution = useCallback(() => {
    if (mode !== 'book-explorer' || !activeBookLine || quizStatus !== 'playing') return;

    if (quizMode === 'quiz') {
      if (activeBookMoveIdx !== solvedMoveIdx) {
        setQuizFeedback({ type: 'error', text: 'Navigate to the current position to reveal solution!' });
        return;
      }

      const nextIdx = activeBookMoveIdx + 1;
      if (nextIdx >= activeBookLine.moves.length) return;
      const expectedMove = activeBookLine.moves[nextIdx];

      // Mark as mistake since they had to reveal the solution
      if (!quizMistakes.includes(nextIdx)) {
        setQuizMistakes(prev => [...prev, nextIdx]);
        fetch('/api/puzzles/attempt', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            puzzleId: null,
            startFen: expectedMove.fen_before,
            success: false
          })
        }).catch(console.error);
      }

      setQuizFeedback({ type: 'success', text: `Solution: ${expectedMove.san}`, square: expectedMove.uci.slice(2, 4) });
      setActiveBookMoveIdx(nextIdx);
      setSolvedMoveIdx(nextIdx);
      playMoveSound(expectedMove.san.includes('x'));
    } else if (quizMode === 'review') {
      if (reviewQueue.length === 0) return;
      const reviewItem = reviewQueue[currentReviewIdx];
      const expectedMove = activeBookLine.moves[reviewItem.moveIdx];

      if (activeBookMoveIdx !== reviewItem.moveIdx - 1) {
        setQuizFeedback({ type: 'error', text: 'Navigate to the review position to reveal solution!' });
        return;
      }

      setQuizFeedback({ type: 'success', text: `Solution: ${expectedMove.san}`, square: expectedMove.uci.slice(2, 4) });
      
      // Temporarily show the move on the board
      setActiveBookMoveIdx(reviewItem.moveIdx);
      playMoveSound(expectedMove.san.includes('x'));

      // Reset count to 2 because they revealed it
      setReviewQueue(prev => prev.map((item, idx) => idx === currentReviewIdx ? { ...item, count: 2 } : item));

      // Reset board back to review position after 1.5 seconds so they can play it themselves
      setTimeout(() => {
        setActiveBookMoveIdx(reviewItem.moveIdx - 1);
      }, 1500);
    }
  }, [
    mode, activeBookLine, quizMode, quizStatus, activeBookMoveIdx, solvedMoveIdx,
    quizMistakes, reviewQueue, currentReviewIdx
  ]);

  const playUciMove = useCallback((uci: string) => {
    setExplorerLine(null);
    const chess = new Chess(currentFen), m = tryMakeMove(chess, uci);
    if (!m) return;
    if (!baseState) setBaseState({ history, cursor });
    const next = [...history.slice(0, cursor + 1), { fen: chess.fen(), san: m.san, to: m.to }];
    setHistory(next); setCursor(next.length - 1); playMoveSound(m.san.includes('x'));
    setTimeout(() => analyzeLastMove(next, initialFen, orientation), 0);
  }, [currentFen, cursor, history, analyzeLastMove, initialFen, baseState, orientation]);

  const unloadGame = useCallback(() => {
    setActiveGame(null);
    setGameMistakes([]);
    setRelevantBookLine(null);
    setBaseState(null);
    setExplorerLine(null);
    setExplorerMoveIdx(-1);
  }, []);

  const importGameData = useCallback((pgn: string, id?: number) => {
    saveGamePgn(pgn, setActiveGame);
    setupGameMeta(pgn, setOrientation, setActiveGame, id);
  }, []);

  const finishPuzzleLoad = useCallback((entries: HistoryEntry[], sf: string, startFen: string) => {
    setCursor(findTargetCursor(entries, sf, startFen));
    setMode('analysis');
  }, []);

  const loadRawPgn = useCallback((pgn: string, id?: number) => {
    unloadGame();
    const { sf, entries } = parsePgn(pgn);
    setInitialFen(sf);
    setHistory(entries);
    setCursor(-1);
    resetAnalysis();
    analyzeGame(entries, sf, getPlayerOrientation(pgn));
    importGameData(pgn, id);
    setMode('analysis');
  }, [analyzeGame, resetAnalysis, unloadGame, importGameData]);

  const loadGameFromPuzzle = useCallback((pgn: string, startFen: string, id?: number) => {
    unloadGame();
    const { sf, entries } = parsePgn(pgn);
    setInitialFen(sf);
    setHistory(entries);
    resetAnalysis();
    analyzeGame(entries, sf, getPlayerOrientation(pgn));
    setupGameMeta(pgn, setOrientation, setActiveGame, id);
    finishPuzzleLoad(entries, sf, startFen);
  }, [analyzeGame, resetAnalysis, unloadGame, finishPuzzleLoad]);

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
    if (mode === 'book-explorer') {
      setBaseState({
        history,
        cursor,
        initialFen,
        previousMode: 'book-explorer'
      });

      const prefixEntries = activeBookLine
        ? activeBookLine.moves.slice(0, activeBookMoveIdx + 1).map((m: any) => ({
            fen: m.fen_after,
            san: m.san,
            to: m.uci.slice(2, 4)
          }))
        : [];

      const startFenForVar = boardFen || STARTING_FEN;
      const newEntries = buildVariationEntries(startFenForVar, line.pv);
      
      setInitialFen(activeBookLine?.start_fen || STARTING_FEN);
      setHistory([...prefixEntries, ...newEntries]);
      setCursor(prefixEntries.length);
      setMode('analysis');
      if (newEntries[0]) playMoveSound(newEntries[0].san.includes('x'));
      return;
    }

    if (!baseState) {
      setBaseState({ history, cursor, initialFen, previousMode: 'analysis' });
    }
    const newEntries = buildVariationEntries(boardFen || currentFen, line.pv);
    setHistory([...history.slice(0, cursor + 1), ...newEntries]);
    setCursor(cursor + 1);
    if (newEntries[0]) playMoveSound(newEntries[0].san.includes('x'));
  }, [baseState, history, cursor, currentFen, boardFen, mode, activeBookLine, activeBookMoveIdx, initialFen]);

  const exitVariation = useCallback(() => {
    if (!baseState) return;
    setHistory(baseState.history);
    setCursor(baseState.cursor);
    if (baseState.initialFen) {
      setInitialFen(baseState.initialFen);
    }
    if (baseState.previousMode) {
      setMode(baseState.previousMode);
    }
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
  if (mode !== 'book-explorer' && mode !== 'analysis' && relevantBookLine && bookLineActiveIdx >= 0) {
    const activeMove = relevantBookLine.moves[bookLineActiveIdx];
    if (activeMove && activeMove.arrows) {
      try {
        const parsed = JSON.parse(activeMove.arrows);
        const gameBookArrows = parsed.map((a: any) => {
          if (Array.isArray(a)) {
            return { startSquare: a[0], endSquare: a[1], color: a[2] || 'rgba(168,85,247,0.85)' };
          }
          return {
            startSquare: a.startSquare,
            endSquare: a.endSquare,
            color: a.color || 'rgba(168,85,247,0.85)'
          };
        });
        arrows.push(...gameBookArrows);
      } catch (e) {
        console.error('Error parsing game book arrows', e);
      }
    }
  }

  // Board annotation overlay — show icon on the destination square of the current move
  const isVarMove = baseState !== null && cursor > baseState.cursor;
  const annotationSquare = cursor >= 0 && !isVarMove ? history[cursor]?.to : null;
  const currentAnnotation = cursor >= 0 && !isVarMove ? annotations[cursor] : null;

  const squareRenderer = useCallback(
    ({ square, children }: any) => {
      const show = !!(mode !== 'book-explorer' && square === annotationSquare && currentAnnotation?.types?.length);
      const hasQuizFeedback = mode === 'book-explorer' && quizFeedback && square === quizFeedback.square;
      return (
        <div className="relative w-full h-full">
          {children}
          {show && <SquareAnnotations types={currentAnnotation.types} />}
          {hasQuizFeedback && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-30 animate-scale-up">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 shadow-lg ${
                quizFeedback.type === 'success' 
                  ? 'bg-zinc-900/95 border-emerald-500 text-emerald-400' 
                  : 'bg-zinc-900/95 border-red-500 text-red-400'
              }`}>
                {quizFeedback.type === 'success' ? (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
              </div>
            </div>
          )}
        </div>
      );
    },
    [annotationSquare, currentAnnotation, mode, quizFeedback]
  );

  const evalLabel = () => {
    const { mate, score } = evaluation;
    if (mate !== null) return mate === 0 ? '#' : `M${Math.abs(mate)}`;
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
          <button onClick={() => setShowPgnPanel((v) => !v)}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-all shadow-md flex items-center gap-1 cursor-pointer">
            📥 {showPgnPanel ? 'Close PGN' : 'Import PGN'}
          </button>
          {history.length > 0 && (
            analyzing ? (
              <span className="text-xs px-3 py-1 rounded bg-yellow-900/50 text-yellow-300 border border-yellow-800">
                Analyzing… {progress}%
              </span>
            ) : annotations.length > 0 ? (
              <>
                {analysisDepth && (
                  <span className="text-xs px-2.5 py-1 rounded bg-zinc-900 text-zinc-400 border border-zinc-800">
                    depth {analysisDepth}
                  </span>
                )}
                <button onClick={startPracticeMode} disabled={loadingGameMistakes}
                  className="text-xs px-3 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white transition-colors cursor-pointer disabled:opacity-50">
                  {loadingGameMistakes ? 'Loading...' : '🧩 Practice Mistakes'}
                </button>
                <button onClick={() => analyzeGame(history, initialFen, orientation)}
                  className="text-xs px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">
                  Re-analyze
                </button>
              </>
            ) : null
          )}
          <button onClick={() => { 
            setMode(mode === 'book-explorer' ? 'analysis' : 'book-explorer'); 
            setActiveBookLine(null); 
            setActiveBookMoveIdx(-1);
            setQuizMode('quiz');
            setSolvedMoveIdx(-1);
            setQuizMistakes([]);
            setReviewQueue([]);
            setCurrentReviewIdx(0);
            setQuizStatus('playing');
            setQuizFeedback(null);
            setQuizStartFen(null);
            setIsTempSubgroupActive(false);
          }}
            className={`text-xs px-3 py-1 rounded transition-colors cursor-pointer ${mode === 'book-explorer' ? 'bg-blue-600 hover:bg-blue-500 text-white font-bold' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}>
            📖 Book Lines
          </button>
          <button onClick={() => setMode('puzzles')}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer">
            🧩 Puzzles
          </button>
          <button onClick={() => setShowLibrary(true)}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors cursor-pointer">
            📚 Library
          </button>
          <button onClick={() => setOrientation((o) => o === 'white' ? 'black' : 'white')}
            className="text-xs px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 transition-colors">
            Flip ⇅
          </button>
          <button onClick={() => { setHistory([]); setCursor(-1); resetAnalysis(); setInitialFen(STARTING_FEN); setActiveGame(null); setMode('analysis'); setActiveBookLine(null); setActiveBookMoveIdx(-1); setQuizStartFen(null); setIsTempSubgroupActive(false); }}
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
      ) : mode === 'game-puzzles' ? (
        <GamePuzzleArena
          mistakes={gameMistakes}
          gameTitle={activeGame ? `${activeGame.white} vs ${activeGame.black}` : 'Active Game'}
          playerColor={orientation}
          onExit={() => setMode('analysis')}
        />
      ) : (
        <div className="flex flex-1 overflow-hidden">
        {/* Eval bar */}
        <div className="flex items-stretch px-2 py-2 shrink-0">
          <EvalBar evaluation={evaluation} orientation={orientation} turn={boardColor} />
        </div>

        {/* Board */}
        <div className="flex flex-col items-center justify-center flex-1 p-2 gap-4">
          <div className="relative aspect-square" style={{ width: 'min(calc(100vh - 280px), calc(100vw - 820px))' }}>
            <ChessboardProvider
              key={boardKey}
              options={{
                position: tempWrongFen || boardFen,
                boardOrientation: orientation,
                arrows: mode === 'book-explorer'
                  ? ((quizMode === 'study' || activeBookMoveIdx <= solvedMoveIdx) ? loadedArrows : [])
                  : (mode === 'analysis' ? loadedArrows : []),
                allowDrawingArrows: mode === 'analysis' || quizMode === 'study' || activeBookMoveIdx <= solvedMoveIdx,
                animationDurationInMs: 150,
                darkSquareStyle: { backgroundColor: '#b58863' },
                lightSquareStyle: { backgroundColor: '#f0d9b5' },
                onPieceDrop,
                squareRenderer,
                onArrowsChange: ({ arrows }) => {
                  if (mode !== 'book-explorer' && mode !== 'analysis') return;
                  if (mode === 'book-explorer') {
                    if (activeBookMoveIdx < 0) return;
                    if (quizMode !== 'study' && activeBookMoveIdx > solvedMoveIdx) return;
                  }
                  const newArrows = arrows.map((a: any) => {
                    const startSquare = a.startSquare || (Array.isArray(a) ? a[0] : '');
                    const endSquare = a.endSquare || (Array.isArray(a) ? a[1] : '');
                    return {
                      startSquare,
                      endSquare,
                      color: 'rgba(168,85,247,0.85)' // Violet styling
                    };
                  });
                  if (!areArrowsEqual(newArrows, drawnArrows)) {
                    setDrawnArrows(newArrows);
                    if (mode === 'book-explorer') {
                      autoSaveArrows(newArrows);
                    } else if (mode === 'analysis') {
                      autoSaveAnalysisArrows(newArrows);
                    }
                  }
                }
              }}
            >
              <Chessboard />
            </ChessboardProvider>
            <CustomBoardArrows arrows={mode === 'book-explorer' && quizMode !== 'study' ? [] : arrows} orientation={orientation} />
          </div>
          <div className="w-full overflow-visible" style={{ maxWidth: 'min(calc(100vh - 280px), calc(100vw - 820px))' }}>
            <GameGraph annotations={annotations} currentIndex={cursor} onSelect={(i) => { setCursor(i); setExplorerLine(null); }} />
          </div>
        </div>

        {/* Right panel */}
        <div className="w-[760px] flex flex-col border-l border-zinc-800 shrink-0 bg-zinc-950">
          {mode === 'book-explorer' ? (
            <div className="flex-1 flex flex-col overflow-hidden p-4">
              {activeBookLine ? (
                // Active Book Line Detail View
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex items-center justify-between mb-4 shrink-0">
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => {
                          setActiveBookLine(null);
                          setActiveBookMoveIdx(-1);
                          setQuizMode('quiz');
                          setSolvedMoveIdx(-1);
                          setQuizMistakes([]);
                          setReviewQueue([]);
                          setCurrentReviewIdx(0);
                          setQuizStatus('playing');
                          setQuizFeedback(null);
                        }}
                        className="text-xs text-zinc-400 hover:text-zinc-205 transition-colors flex items-center gap-1 cursor-pointer bg-zinc-900 border border-zinc-800 px-2.5 py-1.5 rounded"
                      >
                        ◀ Back to List
                      </button>
                      {isTempSubgroupActive && (
                        <button
                          onClick={async () => {
                            setMode('analysis');
                            setActiveBookLine(null);
                            setActiveBookMoveIdx(-1);
                            setQuizMode('quiz');
                            setSolvedMoveIdx(-1);
                            setQuizMistakes([]);
                            setReviewQueue([]);
                            setCurrentReviewIdx(0);
                            setQuizStatus('playing');
                            setQuizFeedback(null);
                            await restoreAllOpenings();
                          }}
                          className="text-xs text-rose-400 hover:text-rose-300 transition-colors flex items-center gap-1 cursor-pointer bg-zinc-900 border border-rose-950 px-2.5 py-1.5 rounded font-semibold"
                        >
                          ✕ Cancel Practice
                        </button>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${activeBookLine.color === 'w' ? 'bg-zinc-850 text-zinc-250 border border-zinc-700' : 'bg-zinc-955 text-zinc-455 border border-zinc-850'}`}>
                        {activeBookLine.color === 'w' ? 'White' : 'Black'}
                      </span>
                    </div>

                    {activeLineIndexAndParent && (
                      <div className="flex items-center gap-2">
                        <button
                          disabled={!activeLineIndexAndParent.hasPrev || loadingDetailId !== null}
                          onClick={() => {
                            const prevLine = activeLineIndexAndParent.parentOpening.lines[activeLineIndexAndParent.index - 1];
                            loadBookLineDetail(prevLine.id);
                          }}
                          className="text-xs text-zinc-300 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded cursor-pointer font-medium"
                          title="Previous variation in this opening"
                        >
                          ◀ Prev Line
                        </button>
                        <span className="text-xs text-zinc-500 font-mono">
                          {activeLineIndexAndParent.index + 1} / {activeLineIndexAndParent.parentOpening.lines.length}
                        </span>
                        <button
                          disabled={!activeLineIndexAndParent.hasNext || loadingDetailId !== null}
                          onClick={() => {
                            const nextLine = activeLineIndexAndParent.parentOpening.lines[activeLineIndexAndParent.index + 1];
                            loadBookLineDetail(nextLine.id);
                          }}
                          className="text-xs text-zinc-300 hover:text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded cursor-pointer font-medium"
                          title="Next variation in this opening"
                        >
                          Next Line ▶
                        </button>
                      </div>
                    )}
                  </div>
                  <h2 className="text-md font-bold text-zinc-100 mb-2 flex items-center gap-1 shrink-0">
                    📖 {activeBookLine.name}
                  </h2>

                  {/* Mode selector tab */}
                  <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 mb-4 shrink-0 font-sans">
                    <button
                      onClick={() => {
                        setQuizMode('study');
                        setQuizStatus('playing');
                      }}
                      className={`flex-1 text-center py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors ${quizMode === 'study' ? 'bg-zinc-800 text-zinc-100' : 'bg-transparent text-zinc-400 hover:text-zinc-200'}`}
                    >
                      📖 Study Mode
                    </button>
                    <button
                      onClick={() => {
                        setQuizMode('quiz');
                        setSolvedMoveIdx(-1);
                        setQuizMistakes([]);
                        setReviewQueue([]);
                        setCurrentReviewIdx(0);
                        setQuizStatus('playing');
                        setQuizFeedback(null);
                        setActiveBookMoveIdx(-1);
                      }}
                      className={`flex-1 text-center py-1.5 rounded text-xs font-semibold cursor-pointer transition-colors ${quizMode !== 'study' ? 'bg-zinc-800 text-zinc-100' : 'bg-transparent text-zinc-400 hover:text-zinc-200'}`}
                    >
                      🎯 Quiz Mode
                    </button>
                  </div>

                  {quizStatus === 'completed' && quizMode !== 'study' ? (
                    // Quiz Completed Dashboard
                    <div className="flex-1 flex flex-col items-center justify-center p-6 bg-zinc-900 border border-zinc-850 rounded-xl space-y-4 text-center my-4 font-sans">
                      {quizMode === 'quiz' && quizMistakes.length > 0 ? (
                        <>
                          <div className="text-3xl">📝</div>
                          <h3 className="text-lg font-bold text-zinc-100">Quiz Completed!</h3>
                          <p className="text-xs text-zinc-400 max-w-sm">
                            You completed the variation, but made <span className="text-orange-400 font-bold font-mono">{quizMistakes.length}</span> mistake{quizMistakes.length > 1 ? 's' : ''}. Let's review them to build muscle memory!
                          </p>
                          <button
                            onClick={() => {
                              setQuizMode('review');
                              setQuizStatus('reviewing');
                              const queue = quizMistakes.map(moveIdx => ({ moveIdx, count: 2 }));
                              setReviewQueue(queue);
                              setCurrentReviewIdx(0);
                              setActiveBookMoveIdx(queue[0].moveIdx - 1);
                              setQuizFeedback(null);
                            }}
                            className="text-xs px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors cursor-pointer w-full max-w-xs"
                          >
                            Start Mistake Review (2 Reps Each)
                          </button>
                        </>
                      ) : quizMode === 'quiz' && quizMistakes.length === 0 ? (
                        <>
                          <div className="text-3xl">🏆</div>
                          <h3 className="text-lg font-bold text-emerald-400">Perfect Quiz!</h3>
                          <p className="text-xs text-zinc-400 max-w-sm">
                            Amazing job! You solved every move correctly on the first try.
                          </p>
                          <button
                            onClick={() => {
                              setSolvedMoveIdx(-1);
                              setQuizMistakes([]);
                              setQuizStatus('playing');
                              setActiveBookMoveIdx(-1);
                              setQuizFeedback(null);
                            }}
                            className="text-xs px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors cursor-pointer w-full max-w-xs"
                          >
                            Play Again
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="text-3xl">🧠</div>
                          <h3 className="text-lg font-bold text-emerald-400">Mistakes Mastered!</h3>
                          <p className="text-xs text-zinc-400 max-w-sm">
                            You repeated every mistake 2 times correctly. Spaced repetition power-up achieved!
                          </p>
                          <button
                            onClick={() => {
                              setQuizMode('quiz');
                              setSolvedMoveIdx(-1);
                              setQuizMistakes([]);
                              setReviewQueue([]);
                              setCurrentReviewIdx(0);
                              setQuizStatus('playing');
                              setQuizFeedback(null);
                              setActiveBookMoveIdx(-1);
                            }}
                            className="text-xs px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors cursor-pointer w-full max-w-xs"
                          >
                            Restart Quiz
                          </button>
                        </>
                      )}

                      <button
                        onClick={() => {
                          setQuizMode('study');
                          setQuizStatus('playing');
                        }}
                        className="text-xs px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 font-semibold border border-zinc-700 transition-colors cursor-pointer w-full max-w-xs"
                      >
                        Switch to Study Mode
                      </button>
                    </div>
                  ) : (
                    // Active Play View
                    <>
                      {quizMode === 'review' && reviewQueue.length > 0 && (
                        <div className="p-3 bg-orange-955/20 border border-orange-900/40 rounded-lg space-y-1 mb-4 shrink-0 font-sans">
                          <div className="text-orange-400 text-[10px] uppercase font-bold tracking-wider">Review Mode: Repeating Mistakes</div>
                          <div className="text-xs text-zinc-350 flex justify-between">
                            <span>
                              Mistake {currentReviewIdx + 1} of {reviewQueue.length} (Move index {reviewQueue[currentReviewIdx].moveIdx})
                            </span>
                            <span className="font-bold text-orange-450">
                              Reps left: {reviewQueue[currentReviewIdx].count}
                            </span>
                          </div>
                          <div className="text-[10px] text-zinc-500">
                            Play the correct move for {activeBookLine.color === 'w' ? 'White' : 'Black'} twice in a row!
                          </div>
                        </div>
                      )}


                      <div className="p-3 bg-zinc-900 border border-zinc-850 rounded-lg space-y-2 mb-4 shrink-0">
                        <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-1 flex items-center justify-between">
                          <span>Variation Moves</span>
                          {quizMode !== 'study' && (
                            <span className="text-[9px] text-zinc-500 normal-case font-normal font-sans">
                              {quizMode === 'quiz' ? 'Find the moves' : 'Review your mistakes'}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1 items-center">
                          <button
                            onClick={() => {
                              setActiveBookMoveIdx(-1);
                              playMoveSound(false);
                            }}
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${activeBookMoveIdx === -1 ? 'bg-zinc-850 border-zinc-700 text-zinc-100 font-bold' : 'bg-zinc-955 border-zinc-900 text-zinc-500 hover:text-zinc-350'}`}
                          >
                            Start
                          </button>
                          {activeBookLine.moves.map((move: any, moveIdx: number) => {
                            const isCurrent = activeBookMoveIdx === moveIdx;
                            const isVisible = isMoveVisible(moveIdx);
                            if (isVisible) {
                              return (
                                <button
                                  key={moveIdx}
                                  onClick={() => {
                                    setActiveBookMoveIdx(moveIdx);
                                    playMoveSound(move.san.includes('x'));
                                  }}
                                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${isCurrent ? 'bg-blue-900/60 border-blue-700 text-blue-105 font-bold' : 'bg-zinc-955 border-zinc-900 text-zinc-450 hover:text-zinc-200'}`}
                                >
                                  {move.san}
                                </button>
                              );
                            } else {
                              return (
                                <span
                                  key={moveIdx}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-mono border bg-zinc-955 border-zinc-900/60 text-zinc-650 select-none cursor-default"
                                  title="Hidden until solved"
                                >
                                  ??
                                </span>
                              );
                            }
                          })}
                        </div>
                      </div>

                      <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-lg shadow-md mb-4 flex flex-col shrink-0">
                        <div className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider mb-2">Move Notes & Visual Annotations</div>
                        {!isMoveVisible(activeBookMoveIdx) || activeBookMoveIdx === -1 ? (
                          <div className="text-xs text-zinc-455 italic py-2 font-sans">
                            {activeBookMoveIdx === -1 
                              ? 'Select a move to see or add notes.' 
                              : quizMode === 'review'
                                ? 'Notes are hidden during mistake review.'
                                : 'Notes and annotations are hidden until this move is solved!'}
                          </div>
                        ) : (
                          <div className="space-y-3 font-sans">
                            <div className="text-xs text-zinc-350 flex items-center justify-between">
                              <span>
                                Notes for <span className="font-mono font-bold text-blue-300">{activeBookLine.moves[activeBookMoveIdx].san}</span> (move {Math.floor((activeBookLine.moves[activeBookMoveIdx].ply + 1) / 2)}{activeBookLine.moves[activeBookMoveIdx].ply % 2 === 1 ? '.' : '...'}):
                              </span>
                              <span className="text-[10px] text-zinc-500 italic">Right-click + drag to draw arrows</span>
                            </div>
                            <textarea
                              value={activeBookNote}
                              onChange={(e) => setActiveBookNote(e.target.value)}
                              placeholder="Add your notes about why this move is played..."
                              className="w-full h-24 bg-zinc-955 border border-zinc-800 rounded p-2 text-xs font-sans resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-200"
                            />
                            <div className="flex justify-end items-center gap-2">
                              {(loadedArrows.length > 0 || drawnArrows.length > 0) && (
                                <button
                                  onClick={async () => {
                                    setLoadedArrows([]);
                                    setDrawnArrows([]);
                                    setBoardKey(k => k + 1);
                                    if (activeBookLine && activeBookMoveIdx >= 0) {
                                      try {
                                        const activeMove = activeBookLine.moves[activeBookMoveIdx];
                                        const updatedMoves = activeBookLine.moves.map((m: any, idx: number) => {
                                          if (idx === activeBookMoveIdx) {
                                            return { ...m, arrows: null };
                                          }
                                          return m;
                                        });
                                        setActiveBookLine({ ...activeBookLine, moves: updatedMoves });
                                        await fetch('/api/book-lines', {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({
                                            lineId: activeBookLine.id,
                                            ply: activeMove.ply,
                                            comment: activeBookNote,
                                            arrows: []
                                          })
                                        });
                                      } catch (err) {
                                        console.error('Error clearing arrows in db:', err);
                                      }
                                    }
                                  }}
                                  className="text-xs px-2.5 py-1.5 rounded bg-zinc-800 hover:bg-zinc-750 text-zinc-300 font-semibold border border-zinc-700 transition-colors cursor-pointer mr-auto"
                                >
                                  Clear Arrows
                                </button>
                              )}
                              {saveNoteSuccess && (
                                <span className="text-[11px] text-emerald-400 font-semibold animate-pulse">✓ Saved!</span>
                              )}
                              <button
                                onClick={handleSaveNote}
                                disabled={isSavingNote}
                                className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50 cursor-pointer"
                              >
                                {isSavingNote ? 'Saving...' : 'Save Notes'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Engine Analysis */}
                      {quizMode === 'study' ? (
                        <div className="px-3 py-2 border border-zinc-900 bg-zinc-950 rounded-lg flex-1 overflow-y-auto font-sans">
                          <div className="flex items-baseline justify-between mb-2">
                            <span className="text-zinc-500 text-[10px] uppercase font-bold tracking-wider">Engine Analysis</span>
                            <span className="text-xs text-zinc-550 font-mono">depth {evaluation.depth}</span>
                          </div>
                          <div className="flex items-baseline justify-between mb-2">
                            <span className="text-xl font-bold font-mono tabular-nums">{evalLabel()}</span>
                          </div>
                          <div className="space-y-1.5 font-sans">
                            {evaluation.lines && evaluation.lines.length > 0 ? (
                              evaluation.lines.slice(0, 3).map((line: any, idx: number) => (
                                <EngineLineRow key={idx} line={line} startFen={boardFen} userColor={orientation === 'white' ? 'w' : 'b'} onClick={() => enterVariation(line)} />
                              ))
                            ) : (
                              evaluation.pv && evaluation.pv.length > 0 && (
                                <p className="text-xs text-zinc-400 break-words font-mono leading-normal">
                                  {pvToSan(boardFen, evaluation.pv).join(' ')}
                                </p>
                              )
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="p-4 border border-zinc-900 bg-zinc-950 rounded-lg flex-1 flex flex-col items-center justify-center text-center text-zinc-500 font-sans">
                          <div className="text-xl mb-1">🤫</div>
                          <div className="text-[10px] uppercase font-bold tracking-wider">Engine Disabled</div>
                          <div className="text-xs text-zinc-500 mt-1">Stockfish analysis is hidden during the quiz.</div>
                        </div>
                      )}

                      {quizMode !== 'study' && quizStatus === 'playing' && (
                        <button
                          onClick={handleShowSolution}
                          className="w-full py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 hover:text-zinc-100 border border-zinc-800 rounded-lg text-xs font-semibold transition-all shadow-md mt-4 cursor-pointer flex items-center justify-center gap-1.5"
                        >
                          💡 Show Solution
                        </button>
                      )}

                      {/* Navigation keyboard arrows reminder / buttons */}
                      <div className="flex gap-1 mt-4 shrink-0 font-sans">
                        {(() => {
                          const maxAllowedIdx = quizMode === 'study' 
                            ? activeBookLine.moves.length - 1 
                            : quizMode === 'review'
                              ? (reviewQueue.length > 0 ? reviewQueue[currentReviewIdx].moveIdx - 1 : -1)
                              : solvedMoveIdx;

                          const navButtons = [
                            { label: '⏮', action: () => { setActiveBookMoveIdx(-1); playMoveSound(false); }, title: 'Start', disabled: activeBookMoveIdx === -1 },
                            { label: '◀', action: () => { if (activeBookMoveIdx > -1) { setActiveBookMoveIdx(c => c - 1); playMoveSound(false); } }, title: 'Prev (←)', disabled: activeBookMoveIdx === -1 },
                            { label: '▶', action: () => { if (activeBookMoveIdx < maxAllowedIdx) { const nextIdx = activeBookMoveIdx + 1; setActiveBookMoveIdx(nextIdx); playMoveSound(activeBookLine.moves[nextIdx].san.includes('x')); } }, title: 'Next (→)', disabled: activeBookMoveIdx >= maxAllowedIdx },
                            { label: '⏭', action: () => { if (maxAllowedIdx >= 0) { setActiveBookMoveIdx(maxAllowedIdx); playMoveSound(activeBookLine.moves[maxAllowedIdx].san.includes('x')); } else { setActiveBookMoveIdx(-1); playMoveSound(false); } }, title: 'End', disabled: activeBookMoveIdx === maxAllowedIdx },
                          ];

                          return navButtons.map(({ label, action, title, disabled }) => (
                            <button
                              key={label}
                              onClick={action}
                              title={title}
                              disabled={disabled}
                              className="flex-1 py-1 rounded bg-zinc-900 hover:bg-zinc-800 disabled:opacity-30 disabled:hover:bg-zinc-900 disabled:cursor-not-allowed text-sm transition-colors border border-zinc-805 cursor-pointer text-zinc-300 font-semibold"
                            >
                              {label}
                            </button>
                          ));
                        })()}
                      </div>
                    </>
                  )}
                </div>
              ) : (
                // Book Lines List Explorer View
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="space-y-3 mb-4 shrink-0 font-sans">
                    <div className="flex items-center justify-between">
                      <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">📖 Book Line Explorer</h2>
                      {isTempSubgroupActive && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={async () => {
                              setMode('analysis');
                              await restoreAllOpenings();
                            }}
                            className="text-[10px] px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-350 rounded font-semibold border border-zinc-700 transition-colors cursor-pointer"
                          >
                            Exit Practice
                          </button>
                          <button
                            onClick={restoreAllOpenings}
                            className="text-[10px] px-2.5 py-1 bg-blue-900/40 hover:bg-blue-900/65 text-blue-300 rounded font-semibold border border-blue-800 transition-colors cursor-pointer"
                          >
                            🔄 Show All Openings
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={bookLinesSearch}
                        onChange={(e) => setBookLinesSearch(e.target.value)}
                        placeholder="Search variations by name..."
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded py-1.5 px-3 text-xs text-zinc-205 placeholder-zinc-500 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                      />
                      <select
                        value={bookLinesColor}
                        onChange={(e: any) => setBookLinesColor(e.target.value)}
                        className="bg-zinc-900 border border-zinc-800 rounded py-1.5 px-2.5 text-xs text-zinc-350 focus:outline-none cursor-pointer"
                      >
                        <option value="all">All Colors</option>
                        <option value="w">White Lines</option>
                        <option value="b">Black Lines</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto pr-1 space-y-2">
                    {loadingBookLines ? (
                      <div className="text-zinc-500 text-xs italic py-4 text-center">Loading openings list...</div>
                    ) : getFilteredAndGrouped().length === 0 ? (
                      <div className="text-zinc-500 text-xs italic py-4 text-center">No matching variations found.</div>
                    ) : (
                      getFilteredAndGrouped().map((op) => {
                        const opKey = op.id || 'other';
                        const isSearchActive = bookLinesSearch.trim().length > 0;
                        const isExpanded = !!expandedOpenings[opKey] || isSearchActive;
                        return (
                          <div key={opKey} className="border border-zinc-905 rounded bg-zinc-900/10 overflow-hidden font-sans">
                            <button
                              onClick={() => toggleOpeningExpanded(opKey)}
                              className="w-full px-3 py-2 bg-zinc-900/40 hover:bg-zinc-900/60 text-left text-xs font-bold text-zinc-300 flex justify-between items-center transition-colors cursor-pointer border-b border-zinc-900/20"
                            >
                              <span className="truncate flex items-center gap-1.5">
                                {isExpanded ? '▼' : '▶'} {op.name}
                              </span>
                              <span className="text-[10px] text-zinc-500 font-normal shrink-0">
                                {op.lines.length} variation{op.lines.length !== 1 ? 's' : ''}
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="p-1 bg-zinc-950/40 divide-y divide-zinc-900/40 max-h-80 overflow-y-auto">
                                {op.lines.map((line: any) => {
                                  const isSelectedLoading = loadingDetailId === line.id;
                                  return (
                                    <button
                                      key={line.id}
                                      onClick={() => loadBookLineDetail(line.id)}
                                      disabled={loadingDetailId !== null}
                                      className="w-full text-left px-3 py-2 text-xs text-zinc-400 hover:text-zinc-205 hover:bg-zinc-900/30 rounded transition-colors flex justify-between items-center cursor-pointer font-medium disabled:opacity-50"
                                    >
                                      <span className="truncate flex items-center gap-1.5">
                                        📖 {line.name}
                                      </span>
                                      <div className="flex items-center gap-1.5 shrink-0">
                                        {isSelectedLoading && <span className="text-[10px] text-blue-450 animate-pulse font-normal mr-1">Loading...</span>}
                                        <span className={`text-[9px] px-1 rounded font-bold ${line.color === 'w' ? 'text-zinc-350 bg-zinc-800' : 'text-zinc-500 bg-zinc-950 border border-zinc-850'}`}>
                                          {line.color === 'w' ? 'W' : 'B'}
                                        </span>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Standard Analysis Mode right panel
            <>
              {baseState && (
                <div className="bg-blue-950/40 border-b border-blue-900/60 p-2.5 text-center flex flex-col gap-1.5 shrink-0 select-none">
                  <span className="text-xs text-blue-300 font-semibold flex items-center justify-center gap-1">🔍 Viewing Variation Line</span>
                  <button onClick={exitVariation}
                    className="text-xs py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-bold transition-colors cursor-pointer w-full">
                    {baseState.previousMode === 'book-explorer' ? 'Back to Book Lines' : 'Back to Game'}
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
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={practiceVariationsFromCurrentPosition}
                        className="text-[10px] px-2.5 py-1 bg-blue-900/60 hover:bg-blue-800/80 text-blue-100 rounded font-semibold border border-blue-700 transition-colors cursor-pointer animate-pulse"
                      >
                        🎯 Practice from Here
                      </button>
                      {explorerLine && (
                        <button 
                          onClick={() => setExplorerLine(null)}
                          className="text-[10px] px-2 py-0.5 bg-zinc-850 hover:bg-zinc-800 text-zinc-300 rounded font-semibold border border-zinc-700 transition-colors cursor-pointer"
                        >
                          Exit Explorer
                        </button>
                      )}
                    </div>
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
                            className={`px-1.5 py-0.5 rounded text-[10px] font-mono border cursor-pointer transition-colors ${isCurrentMove ? 'bg-blue-900/60 border-blue-700 text-blue-100 font-bold' : 'bg-zinc-955 border-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
                          >
                            {move.san}
                          </button>
                        );
                      })}
                    </div>
                    {bookLineActiveIdx >= 0 && bookLineActiveIdx < relevantBookLine.moves.length && (
                      <div className="mt-2.5 p-2.5 bg-zinc-955/60 border border-zinc-850 rounded font-sans">
                        <div className="text-zinc-505 text-[9px] uppercase font-bold tracking-wider mb-1 flex items-center justify-between">
                          <span>Book Note</span>
                          <span className="text-[8px] text-zinc-500 font-normal normal-case font-mono">Move {Math.floor((relevantBookLine.moves[bookLineActiveIdx].ply + 1) / 2)}{relevantBookLine.moves[bookLineActiveIdx].ply % 2 === 1 ? '.' : '...'}</span>
                        </div>
                        {relevantBookLine.moves[bookLineActiveIdx].comment ? (
                          <p className="text-xs text-zinc-300 leading-normal whitespace-pre-wrap">
                            {relevantBookLine.moves[bookLineActiveIdx].comment}
                          </p>
                        ) : (
                          <p className="text-xs text-zinc-600 italic">No notes saved for this position.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Book moves */}
              {bookMoves.length > 0 && (
                <div className="px-3 py-2 border-b border-zinc-800 shrink-0">
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] uppercase tracking-widest text-zinc-500">Book moves</p>
                    <button
                      onClick={practiceVariationsFromCurrentPosition}
                      className="text-[10px] px-2 py-0.5 bg-blue-900/60 hover:bg-blue-800/80 text-blue-100 rounded font-semibold border border-blue-700 transition-colors cursor-pointer animate-pulse"
                    >
                      🎯 Practice from Here
                    </button>
                  </div>
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
                              <p key={i} className="text-[10px] text-zinc-350 leading-tight truncate">{name}</p>
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

              {/* Game Position Note taking */}
              <div className="px-3 py-3 border-b border-zinc-800 shrink-0 font-sans space-y-2">
                <div className="flex items-center justify-between text-[10px] uppercase font-bold tracking-wider text-zinc-550">
                  <span>Position Notes & Annotations</span>
                  <span className="text-zinc-600 font-normal italic font-mono normal-case">Right-click + drag to draw arrows</span>
                </div>
                <textarea
                  value={activeBookNote}
                  onChange={(e) => setActiveBookNote(e.target.value)}
                  placeholder="Save notes for this specific board position (auto-shared across all games!)..."
                  className="w-full h-16 bg-zinc-900 border border-zinc-805 rounded p-1.5 text-xs font-sans resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-200"
                />
                <div className="flex justify-end items-center gap-2">
                  {(loadedArrows.length > 0 || drawnArrows.length > 0) && (
                    <button
                      onClick={async () => {
                        setLoadedArrows([]);
                        setDrawnArrows([]);
                        setBoardKey(k => k + 1);
                        try {
                          await fetch('/api/book-lines', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              fen: boardFen,
                              comment: activeBookNote,
                              arrows: []
                            })
                          });
                          // Sync relevantBookLine in memory!
                          if (relevantBookLine && bookLineActiveIdx >= 0) {
                            const updatedMoves = relevantBookLine.moves.map((m: any, idx: number) => {
                              if (idx === bookLineActiveIdx) {
                                return { ...m, arrows: null };
                              }
                              return m;
                            });
                            setRelevantBookLine({ ...relevantBookLine, moves: updatedMoves });
                          }
                        } catch (err) {
                          console.error('Error clearing position arrows:', err);
                        }
                      }}
                      className="text-[10px] px-2 py-1 rounded bg-zinc-850 hover:bg-zinc-800 border border-zinc-700 text-zinc-350 transition-colors cursor-pointer mr-auto"
                    >
                      Clear Arrows
                    </button>
                  )}
                  {saveNoteSuccess && (
                    <span className="text-[10px] text-emerald-455 font-semibold animate-pulse">✓ Saved!</span>
                  )}
                  <button
                    onClick={async () => {
                      setIsSavingNote(true);
                      try {
                        const combined = [...loadedArrows, ...drawnArrows];
                        const res = await fetch('/api/book-lines', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            fen: boardFen,
                            comment: activeBookNote,
                            arrows: combined
                          })
                        });
                        if (res.ok) {
                          setSaveNoteSuccess(true);
                          const loaded = combined.map(a => ({
                            startSquare: a.startSquare,
                            endSquare: a.endSquare,
                            color: a.color || 'rgba(168,85,247,0.85)'
                          }));
                          setLoadedArrows(loaded);
                          setDrawnArrows([]);

                          // Sync relevantBookLine in memory!
                          if (relevantBookLine && bookLineActiveIdx >= 0) {
                            const updatedMoves = relevantBookLine.moves.map((m: any, idx: number) => {
                              if (idx === bookLineActiveIdx) {
                                return {
                                  ...m,
                                  comment: activeBookNote,
                                  arrows: combined.length > 0 ? JSON.stringify(combined) : null
                                };
                              }
                              return m;
                            });
                            setRelevantBookLine({ ...relevantBookLine, moves: updatedMoves });
                          }
                        }
                      } catch (err) {
                        console.error('Error saving game position note:', err);
                      } finally {
                        setIsSavingNote(false);
                      }
                    }}
                    disabled={isSavingNote}
                    className="text-[10px] px-3 py-1 rounded bg-blue-900/80 hover:bg-blue-800/80 text-blue-100 font-semibold border border-blue-700 transition-colors cursor-pointer"
                  >
                    {isSavingNote ? 'Saving...' : 'Save Note'}
                  </button>
                </div>
              </div>

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
                    className="flex-1 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-sm transition-colors cursor-pointer border border-zinc-800">
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
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
  chess.loadPgn(preprocessPgn(pgn).trim());
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
  chess.loadPgn(preprocessPgn(pgn).trim());
  const h = chess.header();
  const white = h.White || 'Unknown', black = h.Black || 'Unknown';
  const whiteEloRaw = h.WhiteElo ? parseInt(h.WhiteElo, 10) : null;
  const blackEloRaw = h.BlackElo ? parseInt(h.BlackElo, 10) : null;
  const whiteElo = whiteEloRaw && !isNaN(whiteEloRaw) ? whiteEloRaw : null;
  const blackElo = blackEloRaw && !isNaN(blackEloRaw) ? blackEloRaw : null;
  return { white, black, result: h.Result || '*', date: h.Date || 'Unknown', whiteElo, blackElo };
}

function setupGameMeta(pgn: string, setOrientation: any, setActiveGame: any, id?: number) {
  setOrientation(getPlayerOrientation(pgn));
  setActiveGame({ ...parseGameMeta(pgn), id });
}

function getPlayerOrientation(pgn: string): 'white' | 'black' {
  const chess = new Chess();
  chess.loadPgn(preprocessPgn(pgn).trim());
  const headers = chess.header();
  const black = headers['Black'] ?? '';
  return isUserBlack(black) ? 'black' : 'white';
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
  if (line.mate !== null) return line.mate === 0 ? '#' : `M${Math.abs(line.mate)}`;
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

function findTargetCursor(entries: HistoryEntry[], sf: string, startFen: string) {
  const target = normalizeBookFen(startFen);
  if (normalizeBookFen(sf) === target) return -1;
  const idx = entries.findIndex(e => normalizeBookFen(e.fen) === target);
  return idx !== -1 ? idx : -1;
}

function updateHistoryAndCursor(entry: HistoryEntry, cursor: number, setHistory: any, setCursor: any, analyzeLastMove: any, initialFen: string, orientation?: 'white' | 'black') {
  setHistory((prev: HistoryEntry[]) => {
    const next = [...prev.slice(0, cursor + 1), entry];
    setTimeout(() => analyzeLastMove(next, initialFen, orientation), 0);
    return next;
  });
  setCursor((c: number) => c + 1); playMoveSound(entry.san.includes('x'));
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

function getPlayedUci(startFen: string, san: string): string {
  try {
    const chess = new Chess(startFen);
    const m = chess.moves({ verbose: true }).find((x) => x.san === san);
    return m ? m.from + m.to + (m.promotion || '') : '';
  } catch {
    return '';
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

async function fetchBookSolutions(fen: string, detail: any) {
  const res = await fetch(`/api/book-moves?fen=${encodeURIComponent(fen)}`);
  const data = res.ok ? await res.json() : null, moves = data?.moves || [];
  if (moves.length) {
    detail.solutionUci = moves[0].uci;
    detail.solutionSan = moves[0].san;
    detail.solutionUcis = moves.map((m: any) => m.uci);
  }
  if (data?.pv?.length) detail.evaluation = { ...detail.evaluation, pv: data.pv };
}

async function fetchMistakeDetail(i: number, fen: string, san: string, isMissedBook?: boolean) {
  const res = await fetch(`/api/analysis?fen=${encodeURIComponent(fen)}&depth=0`);
  const data = res.ok ? await res.json() : null;
  if (!data?.cached || !data.result?.bestMove) return null;
  const detail: any = { moveIndex: i, startFen: fen, playedSan: san, playedUci: getPlayedUci(fen, san), evaluation: data.result, solutionUci: data.result.bestMove, solutionSan: getSan(fen, data.result.bestMove) };
  if (isMissedBook) await fetchBookSolutions(fen, detail);
  return detail;
}

async function compileGameMistakes(h: HistoryEntry[], ann: any[], col: 'white' | 'black', sf: string) {
  const side = col === 'white' ? 0 : 1, list = [];
  for (let i = 0; i < h.length; i++) {
    const a = ann[i], before = i === 0 ? sf : h[i - 1].fen;
    if (i % 2 !== side || !a || (!a.isMissedBook && (a.cpLoss === undefined || a.cpLoss < 50))) continue;
    const d = await fetchMistakeDetail(i, before, h[i].san, a.isMissedBook);
    if (d) list.push({ ...d, cpLoss: a.cpLoss ?? 0, isMissedBook: a.isMissedBook });
  }
  return list;
}

function getPlayerMistakeCount(annotations: any[], orientation: 'white' | 'black'): number {
  const side = orientation === 'white' ? 0 : 1;
  return annotations.filter((ann, idx) => {
    if (idx % 2 !== side || !ann) return false;
    return (ann.cpLoss !== undefined && ann.cpLoss >= 50) || ann.isMissedBook;
  }).length;
}
