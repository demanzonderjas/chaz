export type EvalResult = {
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
  onScore: (score: number) => void;
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
  private annotationQueue: AnnotationTask[] = [];
  private activeAnnotation: AnnotationTask | null = null;
  private lastAnnotationScore = 0;
  private onProgressCallback: ((completed: number, total: number) => void) | null = null;
  private onFinishedCallback: (() => void) | null = null;
  private totalAnnotationTasks = 0;

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
  }

  private handleMessage(line: string) {
    if (!line) return;
    if (line === 'uciok') this.worker?.postMessage('isready');
    if (line === 'readyok') this.setReadyState(true);
    if (line.startsWith('info')) this.handleInfo(line);
    if (line.startsWith('bestmove')) this.handleBestmove(line);
  }

  private handleInfo(line: string) {
    if (!line.includes('score')) return;
    if (this.liveTask) {
      const res = this.parseLiveInfo(line, this.liveTask.color);
      this.lastLiveResult = res;
      this.liveTask.onInfo(res);
    } else if (this.activeAnnotation) {
      this.lastAnnotationScore = this.parseAnnotationScore(line, this.activeAnnotation.color);
    }
  }

  private parseLiveInfo(line: string, color: 'w' | 'b'): EvalResult {
    const depth = parseInt(line.match(/depth (\d+)/)?.[1] ?? '0');
    const pv = line.match(/ pv (.+)/)?.[1]?.trim().split(' ') ?? [];
    const cpRaw = line.match(/score cp (-?\d+)/)?.[1];
    const mtRaw = line.match(/score mate (-?\d+)/)?.[1];
    const score = cpRaw ? (color === 'w' ? +cpRaw : -+cpRaw) : null;
    const mate = mtRaw ? (color === 'w' ? +mtRaw : -+mtRaw) : null;
    return { depth, score: mtRaw ? null : score, mate, pv, bestMove: pv[0] ?? null };
  }

  private parseAnnotationScore(line: string, color: 'w' | 'b'): number {
    const cpMatch = line.match(/score cp (-?\d+)/);
    const mateMatch = line.match(/score mate (-?\d+)/);
    const sign = color === 'w' ? 1 : -1;
    if (cpMatch) return parseInt(cpMatch[1]) * sign;
    if (mateMatch) return (parseInt(mateMatch[1]) * sign > 0 ? 30000 : -30000);
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
      depth: task.depth, score: s, bestMove: mv, pv: [],
      mate: Math.abs(s) >= 30000 ? (s > 0 ? 30000 : -30000) : null,
    });
    task.onScore(s);
  }

  public startLiveEval(task: LiveTask) {
    this.stopCurrentSearch();
    this.liveTask = task;
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
    this.worker?.postMessage(`position fen ${fen}`);
    this.worker?.postMessage(`go depth ${depth}`);
    this.isSearching = true;
  }

  private async runNext() {
    if (this.isSearching || this.pendingStops > 0 || this.checkingCache) return;
    if (this.liveTask) {
      await this.runLiveTask(this.liveTask);
      return;
    }
    await this.runNextAnnotation();
  }

  private async runLiveTask(task: LiveTask) {
    this.checkingCache = true;
    const cached = await this.checkCache(task.fen, task.depth, task.color);
    this.checkingCache = false;
    this.handleLiveCacheResult(task, cached);
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
    next.onScore(cached.score ?? 0);
    this.runNext();
  }

  private notifyProgress() {
    if (!this.onProgressCallback) return;
    const activeOffset = this.activeAnnotation ? 0 : 1;
    const completed = this.totalAnnotationTasks - this.annotationQueue.length - activeOffset;
    this.onProgressCallback(completed, this.totalAnnotationTasks);
  }

  public addAnnotationTasks(tasks: AnnotationTask[]) {
    this.stopCurrentSearch();
    this.annotationQueue = [...tasks];
    this.totalAnnotationTasks = tasks.length;
    this.runNext();
  }

  public clearAnnotationQueue() {
    this.stopCurrentSearch();
    this.annotationQueue = [];
    this.totalAnnotationTasks = 0;
    this.activeAnnotation = null;
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

const stockfishScheduler = new StockfishScheduler();
export default stockfishScheduler;
