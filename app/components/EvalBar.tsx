'use client';

import { EvalResult } from '../hooks/useStockfish';

type Props = { evaluation: EvalResult; orientation: 'white' | 'black'; turn?: 'w' | 'b' };

export function EvalBar({ evaluation, orientation, turn }: Props) {
  const { score, mate } = evaluation;

  let whitePct = 50;
  if (mate !== null) {
    whitePct = mate === 0 ? (turn === 'w' ? 2 : 98) : (mate > 0 ? 98 : 2);
  } else if (score !== null) {
    const clamped = Math.max(-1000, Math.min(1000, score));
    whitePct = 50 + (clamped / 1000) * 48;
  }

  const blackPct = 100 - whitePct;
  const flipped = orientation === 'black';

  const label = () => {
    if (mate !== null) return mate === 0 ? '#' : (mate > 0 ? `M${mate}` : `M${Math.abs(mate)}`);
    if (score === null) return '0.00';
    const abs = Math.abs(score / 100);
    return (score >= 0 ? '+' : '-') + abs.toFixed(2);
  };

  return (
    <div className="flex flex-col w-6 rounded overflow-hidden border border-zinc-700 relative select-none"
         style={{ height: '100%' }}>
      <div
        className="bg-zinc-900 transition-all duration-300"
        style={{ height: flipped ? `${whitePct}%` : `${blackPct}%` }}
      />
      <div
        className="bg-zinc-100 transition-all duration-300"
        style={{ height: flipped ? `${blackPct}%` : `${whitePct}%` }}
      />
      <span
        className="absolute left-1/2 -translate-x-1/2 text-[9px] font-bold pointer-events-none"
        style={{
          top: (flipped ? whitePct : blackPct) < 20 ? '4px' : undefined,
          bottom: (flipped ? whitePct : blackPct) >= 20 ? '4px' : undefined,
          color: (flipped ? whitePct < 50 : blackPct < 50) ? '#18181b' : '#f4f4f5',
        }}
      >
        {label()}
      </span>
    </div>
  );
}
