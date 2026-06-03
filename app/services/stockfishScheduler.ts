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
  private liveTask: LiveTask | null = null;
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
      this.liveTask.onInfo(this.parseLiveInfo(line, this.liveTask.color));
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
      return this.runNext();
    }
    this.isSearching = false;
    this.completeCurrentTask(line.split(' ')[1]);
    this.runNext();
  }

  private completeCurrentTask(mv: string) {
    if (this.liveTask) {
      this.liveTask.onInfo({ depth: 0, score: null, mate: null, bestMove: mv, pv: [] });
      this.liveTask = null;
    } else if (this.activeAnnotation) {
      this.activeAnnotation.onScore(this.lastAnnotationScore);
      this.activeAnnotation = null;
    }
  }

  public startLiveEval(task: LiveTask) {
    this.stopCurrentSearch();
    this.liveTask = task;
    this.runNext();
  }

  private stopCurrentSearch() {
    if (!this.isSearching) return;
    this.pendingStops++;
    this.worker?.postMessage('stop');
    this.isSearching = false;
    this.liveTask = null;
    this.restoreActiveAnnotation();
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

  private runNext() {
    if (this.isSearching || this.pendingStops > 0) return;
    if (this.liveTask) {
      this.sendSearch(this.liveTask.fen, this.liveTask.depth);
      return;
    }
    this.runNextAnnotation();
  }

  private runNextAnnotation() {
    const next = this.annotationQueue.shift();
    if (!next) return this.onFinishedCallback?.();
    this.activeAnnotation = next;
    this.lastAnnotationScore = 0;
    this.sendSearch(next.fen, next.depth);
    this.notifyProgress();
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
}

const stockfishScheduler = new StockfishScheduler();
export default stockfishScheduler;
