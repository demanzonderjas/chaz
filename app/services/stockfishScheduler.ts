import { Chess } from 'chess.js';

export type PvLine = {
  multipv: number;
  depth: number;
  score: number | null;
  mate: number | null;
  pv: string[];
  bestMove: string | null;
  hasSacrifice?: boolean;
};

export type EvalResult = {
  lines?: PvLine[];
  depth: number;
  score: number | null;
  mate: number | null;
  bestMove: string | null;
  pv: string[];
};

export interface LiveTask {
  fen: string;
  color: 'w' | 'b';
  depth: number;
  onInfo: (evalResult: EvalResult) => void;
}

export interface AnnotationTask {
  index: number;
  fen: string;
  color: 'w' | 'b';
  depth: number;
  onScore: (score: number, pv?: string[]) => void;
}

class StockfishScheduler {
  private worker: Worker | null = null;
  private ready = false;
  private listeners = new Set<(ready: boolean) => void>();
  private isSearching = false;
  private pendingStops = 0;
  private checkingCache = false;
  private liveTask: LiveTask | null = null;
  private lastLiveResult: EvalResult | null = null;
  private liveLines: PvLine[] = [];
  private annotationQueue: AnnotationTask[] = [];
  private activeAnnotation: AnnotationTask | null = null;
  private lastAnnotationScore = 0;
  private lastAnnotationPv: string[] = [];
  private onProgressCallback: ((completed: number, total: number) => void) | null = null;
  private onFinishedCallback: (() => void) | null = null;
  private totalAnnotationTasks = 0;
  private localCache: Record<string, { cached: boolean; result: any }> = {};
  private lastAnalysisDepth: number | null = null;

  constructor() {
    if (typeof window !== 'undefined') {
      this.initWorker();
    }
  }

  private initWorker() {
    this.worker = new Worker('/stockfish/stockfish-18-single.js');
    this.worker.onmessage = (e) => this.handleMessage(e.data);
    this.worker.postMessage('uci');
  }

  public isReady() {
    return this.ready;
  }

  public getAnalysisDepth(): number | null {
    return this.lastAnalysisDepth;
  }

  public onReadyChange(callback: (ready: boolean) => void) {
    this.listeners.add(callback);
    return () => { this.listeners.delete(callback); };
  }

  private notifyReady() {
    this.listeners.forEach((cb) => cb(this.ready));
  }

  private setReadyState(val: boolean) {
    this.ready = val;
    this.notifyReady();
    if (val) this.runNext();
  }

  private handleMessage(line: string) {
    if (!line) return;
    if (line === 'uciok') this.worker?.postMessage('isready');
    if (line === 'readyok') this.handleReadyOk();
    if (line.startsWith('info')) this.handleInfo(line);
    if (line.startsWith('bestmove')) this.handleBestmove(line);
  }

  private handleInfo(line: string) {
    if (!line.includes('score')) return;
    if (this.liveTask) {
      this.accumulateLiveLine(this.parsePvLine(line, this.liveTask.color));
    } else if (this.activeAnnotation) {
      this.lastAnnotationScore = this.parseAnnotationScore(line, this.activeAnnotation.color);
      const m = line.match(/ pv (.+)/);
      if (m) this.lastAnnotationPv = m[1].trim().split(' ');
    }
  }

  private parsePvLine(line: string, color: 'w' | 'b'): PvLine {
    const depth = parseInt(line.match(/depth (\d+)/)?.[1] ?? '0');
    const multipv = parseInt(line.match(/multipv (\d+)/)?.[1] ?? '1');
    const pv = line.match(/ pv (.+)/)?.[1]?.trim().split(' ') ?? [];
    const cpRaw = line.match(/score cp (-?\d+)/)?.[1];
    const mtRaw = line.match(/score mate (-?\d+)/)?.[1];
    const score = cpRaw ? (color === 'w' ? +cpRaw : -+cpRaw) : null;
    const mate = mtRaw ? (color === 'w' ? +mtRaw : -+mtRaw) : null;
    return { multipv, depth, score: mtRaw ? null : score, mate, pv, bestMove: pv[0] ?? null };
  }

  private accumulateLiveLine(line: PvLine) {
    if (this.lastLiveResult && line.depth > this.lastLiveResult.depth) {
      this.liveLines = [];
    }
    line.hasSacrifice = hasSacrificeInPVCached(this.liveTask!.fen, line.pv, this.liveTask!.color);
    this.liveLines[line.multipv - 1] = line;
    const res = this.buildLiveResult(line);
    this.lastLiveResult = res;
    this.liveTask?.onInfo(res);
  }

  private buildLiveResult(line: PvLine): EvalResult {
    const mainLine = this.liveLines[0] || line;
    return {
      depth: line.depth,
      score: mainLine.score,
      mate: mainLine.mate,
      bestMove: mainLine.bestMove,
      pv: mainLine.pv,
      lines: this.liveLines.filter(Boolean),
    };
  }

  private getMateScore(mateVal: number, color: 'w' | 'b'): number {
    if (mateVal === 0) return color === 'w' ? -30000 : 30000;
    const sign = color === 'w' ? 1 : -1;
    return mateVal * sign > 0 ? 30000 : -30000;
  }

  private parseAnnotationScore(line: string, color: 'w' | 'b'): number {
    const cpMatch = line.match(/score cp (-?\d+)/);
    if (cpMatch) return parseInt(cpMatch[1]) * (color === 'w' ? 1 : -1);
    const mateMatch = line.match(/score mate (-?\d+)/);
    if (mateMatch) return this.getMateScore(parseInt(mateMatch[1]), color);
    return this.lastAnnotationScore;
  }

  private handleBestmove(line: string) {
    if (this.pendingStops > 0) {
      this.pendingStops--;
      this.lastLiveResult = null;
      return this.runNext();
    }
    this.isSearching = false;
    this.completeCurrentTask(line.split(' ')[1]);
    this.runNext();
  }

  private completeCurrentTask(mv: string) {
    if (this.liveTask) {
      this.completeLiveTask();
    } else if (this.activeAnnotation) {
      this.completeAnnotationTask(mv);
    }
  }

  private completeLiveTask() {
    const task = this.liveTask;
    this.liveTask = null;
    if (task && this.lastLiveResult && this.lastLiveResult.depth >= task.depth) {
      this.saveCache(task.fen, task.depth, task.color, this.lastLiveResult);
    }
    this.lastLiveResult = null;
  }

  private completeAnnotationTask(mv: string) {
    const task = this.activeAnnotation;
    this.activeAnnotation = null;
    if (!task) return;
    this.saveAnnotationResult(task, mv);
  }

  private saveAnnotationResult(task: AnnotationTask, mv: string) {
    const s = this.lastAnnotationScore;
    this.saveCache(task.fen, task.depth, task.color, {
      depth: task.depth, score: s, bestMove: mv, pv: this.lastAnnotationPv,
      mate: Math.abs(s) >= 30000 ? (s > 0 ? 30000 : -30000) : null,
    });
    task.onScore(s, this.lastAnnotationPv);
  }

  public startLiveEval(task: LiveTask) {
    this.stopCurrentSearch();
    this.liveTask = task;
    this.runNext();
  }

  public stopLiveEval() {
    this.stopCurrentSearch();
    this.runNext();
  }

  private stopCurrentSearch() {
    this.liveTask = null;
    this.lastLiveResult = null;
    this.restoreActiveAnnotation();
    if (!this.isSearching) return;
    this.pendingStops++;
    this.worker?.postMessage('stop');
    this.isSearching = false;
  }

  private restoreActiveAnnotation() {
    if (this.activeAnnotation) {
      this.annotationQueue.unshift(this.activeAnnotation);
      this.activeAnnotation = null;
    }
  }

  private sendSearch(fen: string, depth: number) {
    const multipv = this.liveTask ? 4 : 1;
    this.worker?.postMessage(`setoption name MultiPV value ${multipv}`);
    this.worker?.postMessage(`position fen ${fen}`);
    this.worker?.postMessage(`go depth ${depth}`);
    this.isSearching = true;
  }

  private async runNext() {
    if (!this.ready || this.isSearching || this.pendingStops > 0 || this.checkingCache) return;
    if (this.liveTask) {
      await this.runLiveTask(this.liveTask);
      return;
    }
    await this.runNextAnnotation();
  }

  private async runLiveTask(task: LiveTask) {
    this.sendSearch(task.fen, task.depth);
  }

  private handleLiveCacheResult(task: LiveTask, cached: EvalResult | null) {
    if (this.liveTask !== task) {
      this.runNext();
      return;
    }
    if (!cached) return this.sendSearch(task.fen, task.depth);
    task.onInfo(cached);
    this.liveTask = null;
    this.runNext();
  }

  private async runNextAnnotation() {
    const next = this.annotationQueue.shift();
    if (!next) return this.onFinishedCallback?.();
    this.activeAnnotation = next;
    this.lastAnnotationScore = 0;
    this.lastAnnotationPv = [];
    this.notifyProgress();
    await this.processAnnotation(next);
  }

  private async processAnnotation(next: AnnotationTask) {
    this.checkingCache = true;
    const cached = await this.checkCache(next.fen, next.depth, next.color);
    this.checkingCache = false;
    this.handleAnnotationCacheResult(next, cached);
  }

  private handleAnnotationCacheResult(next: AnnotationTask, cached: EvalResult | null) {
    if (this.activeAnnotation !== next) {
      this.runNext();
      return;
    }
    if (!cached) return this.sendSearch(next.fen, next.depth);
    this.activeAnnotation = null;
    next.onScore(cached.score ?? 0, cached.pv);
    this.runNext();
  }

  private notifyProgress() {
    if (!this.onProgressCallback) return;
    const activeOffset = this.activeAnnotation ? 0 : 1;
    const completed = this.totalAnnotationTasks - this.annotationQueue.length - activeOffset;
    this.onProgressCallback(completed, this.totalAnnotationTasks);
  }

  private async batchCheckCache(fens: string[], depth: number): Promise<Record<string, { cached: boolean; result: any }>> {
    if (fens.length === 0) return {};
    try {
      const body = JSON.stringify({ fens, depth });
      const res = await fetch('/api/analysis/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body
      });
      const data = res.ok ? await res.json() : null;
      return data?.results || {};
    } catch {
      return {};
    }
  }

  private async handleReadyOk() {
    try {
      const d = await this.runBenchmark('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
      this.lastAnalysisDepth = this.getTargetDepth(d);
    } catch {
      this.lastAnalysisDepth = 14;
    }
    this.setReadyState(true);
  }

  private getTargetDepth(d: number): number {
    if (d <= 12) return 12;
    if (d === 13 || d === 14) return 14;
    if (d === 15) return 16;
    if (d === 16) return 18;
    return 20;
  }

  public runBenchmark(fen: string): Promise<number> {
    return new Promise((resolve) => {
      this.executeBenchmark(fen, resolve);
    });
  }

  private executeBenchmark(fen: string, resolve: (d: number) => void) {
    if (!this.worker) return resolve(14);
    const prev = this.worker.onmessage;
    const timer = setTimeout(() => this.finishBenchmark(prev, 14, resolve), 1000);
    this.worker.onmessage = this.getBenchmarkHandler(prev, timer, resolve);
    this.worker.postMessage('stop');
    this.worker.postMessage(`position fen ${fen}`);
    this.worker.postMessage('go movetime 250');
  }

  private getBenchmarkHandler(prev: any, timer: any, resolve: (d: number) => void) {
    let max = 0;
    return (e: MessageEvent) => {
      const line = e.data || '';
      max = Math.max(max, parseInt(line.match(/depth (\d+)/)?.[1] ?? '0'));
      if (!line.startsWith('bestmove')) return;
      clearTimeout(timer);
      this.finishBenchmark(prev, max, resolve);
    };
  }

  private finishBenchmark(prev: any, depth: number, resolve: (d: number) => void) {
    if (this.worker) this.worker.onmessage = prev;
    resolve(depth);
  }

  public async addAnnotationTasks(tasks: AnnotationTask[]) {
    this.stopCurrentSearch();
    this.annotationQueue = [...tasks];
    this.totalAnnotationTasks = tasks.length;
    this.localCache = {};
    if (tasks.length > 0) await this.initAnnotationTasks(tasks);
    this.runNext();
  }

  private async initAnnotationTasks(tasks: AnnotationTask[]) {
    this.checkingCache = true;
    const depth = this.lastAnalysisDepth ?? 14;
    this.annotationQueue.forEach((t) => { t.depth = depth; });
    await this.fetchAndSetCache(tasks, depth);
    this.checkingCache = false;
  }

  private async fetchAndSetCache(tasks: AnnotationTask[], depth: number) {
    try {
      const fens = tasks.map((t) => t.fen);
      this.localCache = await this.batchCheckCache(fens, depth);
    } catch (e) {
      console.error('Failed to batch check cache', e);
      this.localCache = {};
    }
  }

  public clearAnnotationQueue() {
    this.stopCurrentSearch();
    this.annotationQueue = [];
    this.totalAnnotationTasks = 0;
    this.activeAnnotation = null;
    this.onProgressCallback = null;
    this.onFinishedCallback = null;
    this.lastAnalysisDepth = null;
  }

  public registerCallbacks(
    onProgress: (completed: number, total: number) => void,
    onFinished: () => void
  ) {
    this.onProgressCallback = onProgress;
    this.onFinishedCallback = onFinished;
  }

  public terminate() {
    this.worker?.terminate();
    this.worker = null;
    this.ready = false;
  }

  private async checkCache(fen: string, depth: number, color: 'w' | 'b'): Promise<EvalResult | null> {
    const cached = this.localCache[fen];
    if (cached) {
      return cached.cached ? this.mapCachedResult(cached.result, color) : null;
    }
    try {
      const res = await fetch(`/api/analysis?fen=${encodeURIComponent(fen)}&depth=${depth}`);
      const data = res.ok ? await res.json() : null;
      return data?.cached ? this.mapCachedResult(data.result, color) : null;
    } catch {
      return null;
    }
  }

  private mapCachedResult(r: any, color: 'w' | 'b'): EvalResult {
    const sign = color === 'w' ? 1 : -1;
    return {
      depth: r.depth,
      score: r.cp !== undefined ? r.cp * sign : null,
      mate: r.mate !== undefined ? r.mate * sign : null,
      bestMove: r.bestMove || null,
      pv: r.pv || []
    };
  }

  private async saveCache(fen: string, depth: number, color: 'w' | 'b', result: EvalResult) {
    try {
      const body = JSON.stringify(this.buildSaveBody(fen, depth, color, result));
      await fetch('/api/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    } catch (e) {
      console.error('Failed to save to cache', e);
    }
  }

  private buildSaveBody(fen: string, depth: number, color: 'w' | 'b', res: EvalResult) {
    const sign = color === 'w' ? 1 : -1;
    const cp = res.score !== null ? res.score * sign : undefined;
    const mate = res.mate !== null ? res.mate * sign : undefined;
    return {
      fen, depth,
      result: { bestMove: res.bestMove, pv: res.pv, depth: res.depth, cp, mate }
    };
  }
}

function getMaterialBalance(fen: string): number {
  const board = fen.split(' ')[0];
  const values: Record<string, number> = {
    p: -1, n: -3, b: -3, r: -5, q: -9,
    P: 1, N: 3, B: 3, R: 5, Q: 9
  };
  return [...board].reduce((acc, char) => acc + (values[char] || 0), 0);
}

const sacCache = new Map<string, boolean>();
function hasSacrificeInPVCached(startFen: string, pv: string[], color: 'w' | 'b') {
  if (!pv?.length) return false;
  const key = `${startFen}|${pv.join(' ')}|${color}`;
  if (sacCache.has(key)) return sacCache.get(key)!;
  const res = hasSacrificeInPV(startFen, pv, color);
  if (sacCache.size > 1000) sacCache.delete(sacCache.keys().next().value!);
  sacCache.set(key, res);
  return res;
}

function hasSacrificeInPV(startFen: string, pv: string[], color: 'w' | 'b'): boolean {
  try {
    const chess = new Chess(startFen);
    const startBal = getMaterialBalance(startFen) * (color === 'w' ? 1 : -1);
    pv.forEach((m) => chess.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] }));
    const endBal = getMaterialBalance(chess.fen()) * (color === 'w' ? 1 : -1);
    return endBal < startBal;
  } catch { return false; }
}

const stockfishScheduler = new StockfishScheduler();
export default stockfishScheduler;
