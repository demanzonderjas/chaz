import { useCallback, useRef, useState } from 'react';
import stockfishScheduler, { AnnotationTask } from '../services/stockfishScheduler';

export type AnnotationType = 'book' | 'brilliant' | 'mistake' | 'blunder';

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
  scoresRef: React.MutableRefObject<Record<number, number>>;
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

function classifyMove(cpBefore: number, cpAfter: number): AnnotationType | null {
  const wpBefore = getWinProbability(cpBefore);
  const wpAfter = getWinProbability(cpAfter);
  const wpLoss = wpBefore - wpAfter;
  if (wpLoss <= -0.10 && wpBefore < 0.90 && wpAfter >= 0.40) return 'brilliant';
  if (wpLoss >= 0.20) return 'blunder';
  if (wpLoss >= 0.10) return 'mistake';
  return null;
}

const getUpdatedAnnotation = (existing: MoveAnnotation, cpBefore: number, cpAfter: number, afterScore: number) => {
  const types: AnnotationType[] = (existing.types ?? []).filter((t) => t === 'book');
  const isBook = types.includes('book');
  let engineType = isBook ? null : classifyMove(cpBefore, cpAfter);
  if (!isBook && existing.isMissedBook && !engineType) engineType = 'mistake';
  if (engineType) types.push(engineType);
  return { ...existing, types, cpLoss: isBook ? 0 : cpBefore - cpAfter, score: afterScore };
};

const updateMoveAnnotation = (ctx: AnalysisContext, moveIdx: number) => {
  const s = ctx.scoresRef.current;
  if (s[moveIdx] === undefined || s[moveIdx + 1] === undefined) return;
  const sign = moveIdx % 2 === 0 ? 1 : -1;
  ctx.setAnnotations((prev) => {
    const next = [...prev];
    next[moveIdx] = getUpdatedAnnotation(next[moveIdx] ?? { types: [] }, s[moveIdx] * sign, s[moveIdx + 1] * sign, s[moveIdx + 1]);
    return next;
  });
};

const handleTaskScore = (ctx: AnalysisContext, i: number, score: number) => {
  ctx.scoresRef.current[i] = score;
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
    () => ctx.setAnalyzing(false)
  );
};

const initBookAnnotations = async (ctx: AnalysisContext, history: HistoryEntry[], startFen = STARTING_FEN) => {
  const positions = history.map((h, i) => ({ fen: i === 0 ? startFen : history[i - 1].fen, san: h.san }));
  const data = await fetchBookData(positions);
  ctx.setAnnotations(history.map((h, i) => ({
    types: data.book.has(i) ? (['book'] as AnnotationType[]) : [],
    isMissedBook: !data.book.has(i) && data.options.has(i),
    isCheckmate: h.san.endsWith('#'),
  })));
};

export const analyzeGameImpl = async (ctx: AnalysisContext, history: HistoryEntry[], startFen = STARTING_FEN) => {
  if (!history.length) return;
  ctx.setAnalyzing(true);
  ctx.setProgress(0);
  ctx.scoresRef.current = {};
  await initBookAnnotations(ctx, history, startFen);
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
    onScore: (score: number) => handleTaskScore(ctx, idx, score),
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

export const analyzeLastMoveImpl = async (ctx: AnalysisContext, history: HistoryEntry[], startFen = STARTING_FEN) => {
  if (!history.length) return;
  const i = history.length - 1, before = i === 0 ? startFen : history[i - 1].fen;
  const data = await fetchBookData([{ fen: before, san: history[i].san }]);
  const entry = {
    types: data.book.has(0) ? ['book'] : [],
    isMissedBook: !data.book.has(0) && data.options.has(0),
    isCheckmate: history[i].san.endsWith('#'),
  };
  ctx.setAnnotations((prev) => Object.assign([...prev], { [i]: entry }));
  queueMoveEvaluation(ctx, i, before, history[i].fen);
};

const resetGameAnalysis = (ctx: AnalysisContext) => {
  stockfishScheduler.clearAnnotationQueue();
  ctx.setAnnotations([]);
  ctx.setProgress(0);
  ctx.setAnalyzing(false);
};

export function useGameAnalysis() {
  const [annotations, setAnnotations] = useState<MoveAnnotation[]>([]);
  const [analyzing, setAnalyzing] = useState(false), [progress, setProgress] = useState(0);
  const scoresRef = useRef<Record<number, number>>({});
  const ctx = { setAnnotations, setAnalyzing, setProgress, scoresRef };
  const analyzeGame = useCallback((h: HistoryEntry[], sf?: string) => analyzeGameImpl(ctx, h, sf), []);
  const analyzeLastMove = useCallback((h: HistoryEntry[], sf?: string) => analyzeLastMoveImpl(ctx, h, sf), []);
  const reset = useCallback(() => resetGameAnalysis(ctx), []);
  return { annotations, analyzing, progress, analyzeGame, analyzeLastMove, reset };
}
