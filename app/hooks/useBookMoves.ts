import { useEffect, useState } from 'react';

export type BookMove = {
  san: string;
  uci: string;
  isMainline: boolean;
  lineCount: number;
  lineNames: string[];
  color: string;
};

function fetchBookMoves(fen: string, cb: (m: any) => void): () => void {
  const controller = new AbortController();
  const t = setTimeout(() => {
    fetch(`/api/book-moves?fen=${encodeURIComponent(fen)}`, { signal: controller.signal })
      .then(r => r.json())
      .then(d => cb(d.moves ?? []))
      .catch(err => err.name !== 'AbortError' && cb([]));
  }, 200);
  return () => { clearTimeout(t); controller.abort(); };
}

export function useBookMoves(fen: string) {
  const [moves, setMoves] = useState<BookMove[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!fen) return;
    setLoading(true);
    return fetchBookMoves(fen, (m) => { setMoves(m); setLoading(false); });
  }, [fen]);
  return { moves, loading, inBook: moves.length > 0 };
}

