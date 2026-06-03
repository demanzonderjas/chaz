'use client';

import { useEffect, useRef } from 'react';
import { MoveAnnotation } from '../hooks/useGameAnalysis';

type Props = {
  sanMoves: string[];
  currentIndex: number;
  annotations?: MoveAnnotation[];
  onSelect: (index: number) => void;
  variationStart?: number;
};

const ANNOTATION_ICONS: Record<string, { symbol: string; className: string; title: string }> = {
  book:      { symbol: '📖', className: 'text-blue-400',   title: 'Book move'  },
  brilliant: { symbol: '!!', className: 'text-teal-300',   title: 'Brilliancy' },
  mistake:   { symbol: '?',  className: 'text-orange-400', title: 'Mistake'    },
  blunder:   { symbol: '??', className: 'text-red-400',    title: 'Blunder'    },
};

function formatScore(score?: number): string {
  if (score === undefined) return '';
  if (Math.abs(score) >= 30000) return '#';
  const cp = score / 100;
  return (cp >= 0 ? '+' : '') + cp.toFixed(1);
}

function MoveAnnotations({ annotation }: { annotation?: MoveAnnotation }) {
  if (!annotation?.types.length) return null;
  return (
    <span className="ml-0.5 inline-flex gap-0.5">
      {annotation.types.map((t) => {
        const icon = ANNOTATION_ICONS[t];
        if (!icon) return null;
        return (
          <span
            key={t}
            className={`text-[10px] font-bold leading-none ${icon.className}`}
            title={`${icon.title}${annotation.cpLoss !== undefined ? ` (${annotation.cpLoss > 0 ? '+' : ''}${annotation.cpLoss}cp)` : ''}`}
          >
            {icon.symbol}
          </span>
        );
      })}
    </span>
  );
}

const MoveButton = ({ index, move, activeRef, currentIndex, annotation, onSelect, variationStart }: any) => {
  const active = index === currentIndex, isVar = variationStart !== undefined && variationStart !== -1 && index > variationStart;
  const bg = active ? 'bg-blue-600 text-white' : `hover:bg-zinc-700 ${isVar ? 'text-blue-400 italic font-semibold' : 'text-zinc-100'}`;
  return (
    <button ref={active ? activeRef : null} onClick={() => onSelect(index)} className={`w-full px-2 py-0.5 rounded flex items-center justify-between cursor-pointer ${bg}`}>
      <div className="flex items-center gap-1 min-w-0"><span className="truncate">{move}</span><MoveAnnotations annotation={annotation} /></div>
      {annotation?.score !== undefined && <span className={`text-[10px] font-semibold ${active ? 'text-blue-200' : 'text-zinc-500'}`}>{formatScore(annotation.score)}</span>}
    </button>
  );
};

const MoveRow = ({ pairIdx, white, black, currentIndex, annotations, activeRef, onSelect, variationStart }: any) => (
  <tr className="border-b border-zinc-800">
    <td className="px-2 py-1 text-zinc-500 w-8 select-none">{pairIdx + 1}.</td>
    <td className="px-1 py-1 w-1/2"><MoveButton index={pairIdx * 2} move={white} activeRef={activeRef} currentIndex={currentIndex} annotation={annotations?.[pairIdx * 2]} onSelect={onSelect} variationStart={variationStart} /></td>
    <td className="px-1 py-1 w-1/2">{black !== undefined && <MoveButton index={pairIdx * 2 + 1} move={black} activeRef={activeRef} currentIndex={currentIndex} annotation={annotations?.[pairIdx * 2 + 1]} onSelect={onSelect} variationStart={variationStart} />}</td>
  </tr>
);

export function MoveList({ sanMoves, currentIndex, annotations, onSelect, variationStart }: Props) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => { activeRef.current?.scrollIntoView({ block: 'nearest' }); }, [currentIndex]);
  const pairs = sanMoves.filter((_, i) => i % 2 === 0).map((m, i) => [m, sanMoves[i * 2 + 1]]);
  return (
    <div className="h-full overflow-y-auto font-mono text-sm"><table className="w-full border-collapse">
      <tbody>{pairs.map(([w, b], idx) => <MoveRow key={idx} pairIdx={idx} white={w} black={b} currentIndex={currentIndex} annotations={annotations} activeRef={activeRef} onSelect={onSelect} variationStart={variationStart} />)}</tbody>
    </table></div>
  );
}
