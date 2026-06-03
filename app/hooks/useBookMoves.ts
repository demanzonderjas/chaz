import { useEffect, useState } from 'react';

export type BookMove = {
  san: string;
  uci: string;
  isMainline: boolean;
  lineCount: number;
  lineNames: string[];
  color: string;
};

export function useBookMoves(fen: string) {
  const [moves, setMoves] = useState<BookMove[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fen) return;
    setLoading(true);
    fetch(`/api/book-moves?fen=${encodeURIComponent(fen)}`)
      .then((r) => r.json())
      .then((data) => setMoves(data.moves ?? []))
      .catch(() => setMoves([]))
      .finally(() => setLoading(false));
  }, [fen]);

  return { moves, loading, inBook: moves.length > 0 };
}
