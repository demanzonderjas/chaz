import { useCallback, useRef, useState } from 'react';
import stockfishScheduler, { AnnotationTask } from '../services/stockfishScheduler';
import { Chess } from 'chess.js';

export type AnnotationType = 'book' | 'brilliant' | 'mistake' | 'blunder' | 'missed_book';

export type MoveAnnotation = {
  types: AnnotationType[];
  cpLoss?: number;
  score?: number;
  isMissedBook?: boolean;
  isCheckmate?: boolean;
};

export const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const ANALYSIS_DEPTH = 14;

export type HistoryEntry = { fen: string; san: string; to: string };

interface AnalysisContext {
  setAnnotations: React.Dispatch<React.SetStateAction<MoveAnnotation[]>>;
  setAnalyzing: (val: boolean) => void;
  setProgress: (val: number) => void;
  scoresRef: React.MutableRefObject<Record<number, { score: number; pv?: string[] }>>;
  historyRef: React.MutableRefObject<HistoryEntry[]>;
  setAnalysisDepth: (val: number | null) => void;
  brilliantMovesRef: React.MutableRefObject<string[]>;
}

async function fetchBookData(positions: { fen: string; san: string }[]) {
  try {
    const body = JSON.stringify({ positions });
    const res = await fetch('/api/annotate-game', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    const d = res.ok ? await res.json() : null;
    return { book: new Set<number>(d?.bookIndices), options: new Set<number>(d?.optionIndices) };
  } catch {
    return { book: new Set<number>(), options: new Set<number>() };
  }
}

function getWinProbability(cp: number): number {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

function getMaterialBalance(fen: string): number {
  const board = fen.split(' ')[0];
  const values: Record<string, number> = { p: -1, n: -3, b: -3, r: -5, q: -9, P: 1, N: 3, B: 3, R: 5, Q: 9 };
  return [...board].reduce((acc, char) => acc + (values[char] || 0), 0);
}

function isSacrifice(fenBefore: string, fenAfter: string, pvAfter: string[], playerColor: 'w' | 'b'): boolean {
  try {
    const startBal = getMaterialBalance(fenBefore) * (playerColor === 'w' ? 1 : -1);
    const chess = new Chess(fenAfter);
    
    const balAfterMove = getMaterialBalance(chess.fen()) * (playerColor === 'w' ? 1 : -1);
    if (balAfterMove <= startBal - 2) {
      console.log('SAC FOUND (immediate):', fenBefore, { startBal, balAfterMove });
      return true;
    }
    
    if (pvAfter && pvAfter.length > 0) {
      const m0 = pvAfter[0];
      const move0 = chess.move({ from: m0.slice(0, 2), to: m0.slice(2, 4), promotion: m0[4] });
      if (!move0) return false;
      const balAfterOpp = getMaterialBalance(chess.fen()) * (playerColor === 'w' ? 1 : -1);
      
      if (pvAfter.length > 1) {
        const m1 = pvAfter[1];
        const move1 = chess.move({ from: m1.slice(0, 2), to: m1.slice(2, 4), promotion: m1[4] });
        if (!move1) {
          if (balAfterOpp <= startBal - 2) console.log('SAC FOUND (depth 1):', fenBefore, { startBal, balAfterOpp });
          return balAfterOpp <= startBal - 2;
        }
        const balAfterUs = getMaterialBalance(chess.fen()) * (playerColor === 'w' ? 1 : -1);
        if (balAfterOpp <= startBal - 2 && balAfterUs <= startBal - 2) {
          console.log('SAC FOUND (depth 2):', fenBefore, { startBal, balAfterOpp, balAfterUs });
          return true;
        }
      } else {
        if (balAfterOpp <= startBal - 2) console.log('SAC FOUND (depth 1, no m1):', fenBefore, { startBal, balAfterOpp });
        return balAfterOpp <= startBal - 2;
      }
    }
    return false;
  } catch (e) {
    console.error('isSacrifice error:', e);
    return false; 
  }
}

function classifyMove(cpBefore: number, cpAfter: number, hasSacrifice: boolean): AnnotationType | null {
  const wpBefore = getWinProbability(cpBefore);
  const wpAfter = getWinProbability(cpAfter);
  const wpLoss = wpBefore - wpAfter;
  if (hasSacrifice) {
    console.log('SACRIFICE DETECTED!', { cpBefore, cpAfter, wpLoss, wpAfter, isBrilliant: wpLoss <= 0.10 && wpAfter >= 0.20 });
  }
  if (hasSacrifice && wpLoss <= 0.10 && wpAfter >= 0.20 && Math.abs(cpBefore) <= 800) return 'brilliant';
  if (wpLoss >= 0.20) return 'blunder';
  if (wpLoss >= 0.10) return 'mistake';
  return null;
}

const getUpdatedAnnotation = (existing: MoveAnnotation, cpBefore: number, cpAfter: number, afterScore: number, hasSac: boolean) => {
  const isBook = (existing.types ?? []).includes('book');
  const isPreBrilliant = (existing.types ?? []).includes('brilliant');
  const types: AnnotationType[] = (existing.types ?? []).filter((t) => t === 'book' || t === 'brilliant');
  
  if (isBook || isPreBrilliant) {
    return { ...existing, types, cpLoss: isBook ? 0 : cpBefore - cpAfter, score: afterScore };
  }
  
  let engineType = classifyMove(cpBefore, cpAfter, hasSac);
  if (existing.isMissedBook && !engineType) engineType = 'missed_book';
  if (engineType) types.push(engineType);
  return { ...existing, types, cpLoss: cpBefore - cpAfter, score: afterScore };
};

const updateMoveAnnotation = (ctx: AnalysisContext, moveIdx: number) => {
  const s = ctx.scoresRef.current;
  if (s[moveIdx] === undefined || s[moveIdx + 1] === undefined) return;
  const sign = moveIdx % 2 === 0 ? 1 : -1;
  const scoreBefore = s[moveIdx].score * sign;
  const scoreAfter = s[moveIdx + 1].score * sign;
  
  const history = ctx.historyRef.current;
  let hasSac = false;
  if (history && history.length > moveIdx && s[moveIdx + 1].pv) {
    const fenBefore = moveIdx === 0 ? STARTING_FEN : history[moveIdx - 1].fen;
    const fenAfter = history[moveIdx].fen;
    const playerColor = moveIdx % 2 === 0 ? 'w' : 'b';
    hasSac = isSacrifice(fenBefore, fenAfter, s[moveIdx + 1].pv!, playerColor);
  }
  
  ctx.setAnnotations((prev) => {
    const next = [...prev];
    next[moveIdx] = getUpdatedAnnotation(next[moveIdx] ?? { types: [] }, scoreBefore, scoreAfter, s[moveIdx + 1].score, hasSac);
    return next;
  });
};

const handleTaskScore = (ctx: AnalysisContext, i: number, score: number, pv?: string[]) => {
  ctx.scoresRef.current[i] = { score, pv };
  updateMoveAnnotation(ctx, i - 1);
  updateMoveAnnotation(ctx, i);
};

const getColorToMove = (fen: string): 'w' | 'b' => fen.split(' ')[1] as 'w' | 'b';

const createAnnotationTasks = (ctx: AnalysisContext, fens: string[]) =>
  fens.map((fen, i) => ({
    index: i,
    fen,
    color: getColorToMove(fen),
    depth: ANALYSIS_DEPTH,
    onScore: (score: number) => handleTaskScore(ctx, i, score),
  }));

const registerSchedulerCallbacks = (ctx: AnalysisContext) => {
  stockfishScheduler.registerCallbacks(
    (comp, tot) => ctx.setProgress(Math.round((comp / tot) * 100)),
    () => {
      ctx.setAnalyzing(false);
      ctx.setAnalysisDepth(stockfishScheduler.getAnalysisDepth());
    }
  );
};

function getFirstOppDev(history: HistoryEntry[], data: any, playerColor?: 'white' | 'black') {
  return history.findIndex((_, i) => {
    const isPlayer = playerColor === undefined || i % 2 === (playerColor === 'white' ? 0 : 1);
    return !isPlayer && !data.book.has(i) && data.options.has(i);
  });
}

function buildBookAnnotations(history: HistoryEntry[], data: any, firstOppDev: number, playerColor?: 'white' | 'black') {
  return history.map((h, i) => {
    const isPlayer = playerColor === undefined || i % 2 === (playerColor === 'white' ? 0 : 1);
    return {
      types: data.book.has(i) ? (['book'] as AnnotationType[]) : [],
      isMissedBook: isPlayer ? (!data.book.has(i) && data.options.has(i)) : (i === firstOppDev),
      isCheckmate: h.san.endsWith('#'),
    };
  });
}

const initBookAnnotations = async (ctx: AnalysisContext, history: HistoryEntry[], startFen = STARTING_FEN, playerColor?: 'white' | 'black') => {
  const positions = history.map((h, i) => ({ fen: i === 0 ? startFen : history[i - 1].fen, san: h.san }));
  const data = await fetchBookData(positions);
  const firstOppDev = getFirstOppDev(history, data, playerColor);
  ctx.setAnnotations(buildBookAnnotations(history, data, firstOppDev, playerColor));
};

export const analyzeGameImpl = async (ctx: AnalysisContext, history: HistoryEntry[], startFen = STARTING_FEN, playerColor?: 'white' | 'black', brilliantMoves?: string[]) => {
  if (!history.length) return;
  ctx.historyRef.current = history;
  if (brilliantMoves) ctx.brilliantMovesRef.current = brilliantMoves;
  else ctx.brilliantMovesRef.current = [];

  ctx.setAnalyzing(true);
  ctx.setProgress(0);
  ctx.scoresRef.current = {};
  await initBookAnnotations(ctx, history, startFen, playerColor);
  
  if (ctx.brilliantMovesRef.current.length > 0) {
    ctx.setAnnotations(prev => {
      const next = [...prev];
      history.forEach((h, i) => {
        const fenBefore = i === 0 ? startFen : history[i - 1].fen;
        if (ctx.brilliantMovesRef.current.includes(fenBefore)) {
          const types = [...(next[i]?.types || [])];
          if (!types.includes('brilliant')) types.push('brilliant');
          next[i] = { ...next[i], types };
        }
      });
      return next;
    });
  }

  registerSchedulerCallbacks(ctx);
  const tasks = createAnnotationTasks(ctx, [startFen, ...history.map((h) => h.fen)]);
  stockfishScheduler.addAnnotationTasks(tasks);
};

const pushTaskIfNeeded = (ctx: AnalysisContext, tasks: AnnotationTask[], idx: number, fen: string) => {
  if (ctx.scoresRef.current[idx] !== undefined) return;
  tasks.push({
    index: idx,
    fen,
    color: getColorToMove(fen),
    depth: ANALYSIS_DEPTH,
    onScore: (score: number, pv?: string[]) => handleTaskScore(ctx, idx, score, pv),
  });
};

const queueMoveEvaluation = (ctx: AnalysisContext, i: number, before: string, after: string) => {
  const tasks: AnnotationTask[] = [];
  pushTaskIfNeeded(ctx, tasks, i, before);
  pushTaskIfNeeded(ctx, tasks, i + 1, after);
  if (tasks.length > 0) {
    ctx.setAnalyzing(true); ctx.setProgress(0);
    registerSchedulerCallbacks(ctx);
    stockfishScheduler.addAnnotationTasks(tasks);
  }
};

function hasPrevOpponentDev(prev: MoveAnnotation[], playerColor?: 'white' | 'black') {
  return prev.some((ann, idx) => {
    const isOppIdx = playerColor === undefined || idx % 2 === (playerColor === 'white' ? 1 : 0);
    return isOppIdx && ann?.isMissedBook;
  });
}

const buildLastMoveEntry = (h: HistoryEntry, hasBook: boolean, hasOptions: boolean, isPlayer: boolean, hasPrevOppDev: boolean) => ({
  types: hasBook ? ['book'] as AnnotationType[] : [],
  isMissedBook: isPlayer ? (!hasBook && hasOptions) : (!hasBook && hasOptions && !hasPrevOppDev),
  isCheckmate: h.san.endsWith('#'),
});

export const analyzeLastMoveImpl = async (ctx: AnalysisContext, history: HistoryEntry[], startFen = STARTING_FEN, playerColor?: 'white' | 'black') => {
  if (!history.length) return;
  ctx.historyRef.current = history;
  const i = history.length - 1, before = i === 0 ? startFen : history[i - 1].fen;
  const data = await fetchBookData([{ fen: before, san: history[i].san }]);
  const isPl = playerColor === undefined || i % 2 === (playerColor === 'white' ? 0 : 1);
  ctx.setAnnotations((prev) => Object.assign([...prev], {
    [i]: buildLastMoveEntry(history[i], data.book.has(0), data.options.has(0), isPl, hasPrevOpponentDev(prev, playerColor))
  }));
  queueMoveEvaluation(ctx, i, before, history[i].fen);
};

const resetGameAnalysis = (ctx: AnalysisContext) => {
  stockfishScheduler.clearAnnotationQueue();
  ctx.setAnnotations([]);
  ctx.setProgress(0);
  ctx.setAnalyzing(false);
  ctx.setAnalysisDepth(null);
};

export function useGameAnalysis() {
  const [annotations, setAnnotations] = useState<MoveAnnotation[]>([]);
  const [analyzing, setAnalyzing] = useState(false), [progress, setProgress] = useState(0);
  const [analysisDepth, setAnalysisDepth] = useState<number | null>(null);
  const scoresRef = useRef<Record<number, { score: number; pv?: string[] }>>({});
  const historyRef = useRef<HistoryEntry[]>([]);
  const brilliantMovesRef = useRef<string[]>([]);
  const ctx = { setAnnotations, setAnalyzing, setProgress, scoresRef, historyRef, setAnalysisDepth, brilliantMovesRef };
  const analyzeGame = useCallback((h: HistoryEntry[], sf?: string, pc?: 'white' | 'black', bm?: string[]) => analyzeGameImpl(ctx, h, sf, pc, bm), []);
  const analyzeLastMove = useCallback((h: HistoryEntry[], sf?: string, pc?: 'white' | 'black') => analyzeLastMoveImpl(ctx, h, sf, pc), []);
  const reset = useCallback(() => resetGameAnalysis(ctx), []);
  
  const injectBrilliantMoves = useCallback((fens: string[]) => {
    setAnnotations(prev => {
      const next = [...prev];
      historyRef.current.forEach((h, i) => {
        const fenBefore = i === 0 ? STARTING_FEN : historyRef.current[i - 1].fen;
        if (fens.includes(fenBefore)) {
          const types = [...(next[i]?.types || [])];
          if (!types.includes('brilliant')) types.push('brilliant');
          next[i] = { ...next[i], types };
        }
      });
      return next;
    });
  }, []);

  return { annotations, analyzing, progress, analysisDepth, analyzeGame, analyzeLastMove, reset, injectBrilliantMoves };
}
