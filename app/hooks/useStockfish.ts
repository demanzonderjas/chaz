import { useEffect, useState, useCallback, useRef } from 'react';
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

const useThrottledValue = <T>(initial: T, interval = 150) => {
  const [val, setVal] = useState<T>(initial);
  const ref = useRef<T>(initial);
  useEffect(() => {
    const t = setInterval(() => { if (ref.current !== val) setVal(ref.current); }, interval);
    return () => clearInterval(t);
  }, [val, interval]);
  const setValThrottled = useCallback((next: T) => {
    ref.current = next;
  }, []);
  return [val, setValThrottled] as const;
};

export function useStockfish() {
  const ready = useSchedulerReady();
  const init: EvalResult = { depth: 0, score: 0, mate: null, bestMove: null, pv: [] };
  const [evaluation, setEvaluation] = useThrottledValue<EvalResult>(init);
  const analyse = useCallback((fen: string, color: 'w' | 'b', depth = 22) => {
    stockfishScheduler.startLiveEval({ fen, color, depth, onInfo: setEvaluation });
  }, [setEvaluation]);
  return { ready, evaluation, analyse };
}
