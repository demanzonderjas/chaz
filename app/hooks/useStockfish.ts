import { useEffect, useState, useCallback } from 'react';
import stockfishScheduler, { EvalResult } from '../services/stockfishScheduler';

export type { EvalResult };

function useSchedulerReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(stockfishScheduler.isReady());
    return stockfishScheduler.onReadyChange(setReady);
  }, []);
  return ready;
}

export function useStockfish() {
  const ready = useSchedulerReady();
  const [evaluation, setEvaluation] = useState<EvalResult>({
    depth: 0, score: 0, mate: null, bestMove: null, pv: [],
  });

  const analyse = useCallback((fen: string, color: 'w' | 'b', depth = 22) => {
    stockfishScheduler.startLiveEval({ fen, color, depth, onInfo: setEvaluation });
  }, []);

  return { ready, evaluation, analyse };
}
