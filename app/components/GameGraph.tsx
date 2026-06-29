'use client';

import React, { useEffect, useState, useRef } from 'react';
import { MoveAnnotation } from '../hooks/useGameAnalysis';

type Props = {
  annotations: MoveAnnotation[];
  currentIndex: number;
  onSelect: (index: number) => void;
};

function getWinProbability(cp: number): number {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

const getPointCoords = (index: number, score: number, total: number, width: number, height: number) => {
  const x = total > 1 ? (index / (total - 1)) * width : 0;
  const wp = getWinProbability(score);
  return { x, y: height - wp * height };
};

const getPoint = (ann: MoveAnnotation | undefined | null, i: number, total: number, width: number, height: number, lastY: number) => {
  if (!ann || ann.isCheckmate || ann.score === undefined) {
    const x = total > 1 ? ((i + 1) / total) * width : 0;
    return { x, y: lastY, index: i };
  }
  return { ...getPointCoords(i + 1, ann.score, total + 1, width, height), index: i };
};

const getPoints = (annotations: MoveAnnotation[], width: number, height: number) => {
  const points = [{ x: 0, y: height / 2, index: -1 }];
  let lastY = height / 2;
  annotations.forEach((ann, i) => {
    const p = getPoint(ann, i, annotations.length, width, height, lastY);
    points.push(p);
    lastY = p.y;
  });
  return points;
};

const getPathD = (points: { x: number; y: number }[]) => {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
};

const getAnnotationDetail = (types?: string[], isCheckmate?: boolean) => {
  if (isCheckmate) return { symbol: '#', bg: '#27272a' };
  if (!types || !types.length) return null;
  if (types.includes('blunder')) return { symbol: '??', bg: '#dc2626' };
  if (types.includes('mistake')) return { symbol: '?', bg: '#ea580c' };
  if (types.includes('brilliant')) return { symbol: '!!', bg: '#0d9488' };
  if (types.includes('book')) return { symbol: 'B', bg: '#2563eb' };
  return null;
};

const GraphDot = ({ p, activeIndex, ann, onSelect }: any) => {
  const detail = getAnnotationDetail(ann?.types, ann?.isCheckmate);
  if (!detail || p.index === activeIndex) return null;
  return (
    <g className="cursor-pointer" onClick={() => onSelect(p.index)}>
      <circle cx={p.x} cy={p.y} r="9" fill={detail.bg} stroke="#18181b" strokeWidth="1.5" />
      <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize="9px" fontWeight="black" fill="#ffffff" style={{ pointerEvents: 'none' }}>{detail.symbol}</text>
    </g>
  );
};

const formatEval = (ann: MoveAnnotation | undefined, index: number): string => {
  if (index === -1) return '0.00';
  if (!ann || ann.score === undefined) return ann?.isCheckmate ? '#' : '...';
  if (Math.abs(ann.score) >= 30000) return ann.score > 0 ? '+Mate' : '-Mate';
  const scoreVal = ann.score / 100;
  return (scoreVal >= 0 ? '+' : '') + scoreVal.toFixed(2);
};

const getMoveLabel = (index: number): string => {
  if (index === -1) return 'Start';
  const moveNum = Math.floor(index / 2) + 1;
  return `${moveNum}. ${index % 2 === 0 ? 'White' : 'Black'}`;
};

const findClosestPoint = (points: any[], mouseX: number) => {
  return points.reduce((best, p) => 
    Math.abs(p.x - mouseX) < Math.abs(best.x - mouseX) ? p : best
  , points[0]);
};

const getTooltipCoords = (p: any, width: number, tW = 90, tH = 38) => {
  let x = p.x - tW / 2;
  if (x < 5) x = 5;
  if (x + tW > width - 5) x = width - tW - 5;
  const y = p.y < 45 ? p.y + 12 : p.y - tH - 8;
  return { x, y };
};

const GraphTooltip = ({ p, ann, width, isHovered }: any) => {
  const { x, y } = getTooltipCoords(p, width);
  const stroke = isHovered ? '#71717a' : '#3b82f6';
  return (
    <g transform={`translate(${x}, ${y})`} className="pointer-events-none transition-transform duration-100 ease-out">
      <rect width="90" height="38" rx="4" fill="#18181b" stroke={stroke} strokeWidth="1.5" opacity="0.95" />
      <text x="45" y="14" textAnchor="middle" fontSize="10px" fill="#a1a1aa" fontWeight="medium">{getMoveLabel(p.index)}</text>
      <text x="45" y="28" textAnchor="middle" fontSize="11px" fill={isHovered ? '#f4f4f5' : '#60a5fa'} fontWeight="bold">{formatEval(ann, p.index)}</text>
    </g>
  );
};

const GraphBg = ({ pathD, height, width }: any) => (
  <>
    <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#3f3f46" strokeDasharray="3,3" />
    {pathD && <path d={pathD} fill="none" stroke="#71717a" strokeWidth="2" />}
  </>
);

const ActiveIndicator = ({ active, height }: any) => {
  if (!active) return null;
  return (
    <>
      <line x1={active.x} y1={0} x2={active.x} y2={height} stroke="#3b82f6" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
      <circle cx={active.x} cy={active.y} r="4" fill="#60a5fa" stroke="#ffffff" strokeWidth="1.5" />
    </>
  );
};

const HoverIndicator = ({ hovered, activeIndex, height }: any) => {
  if (!hovered || hovered.index === activeIndex) return null;
  return (
    <>
      <line x1={hovered.x} y1={0} x2={hovered.x} y2={height} stroke="#71717a" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />
      <circle cx={hovered.x} cy={hovered.y} r="4" fill="#a1a1aa" stroke="#ffffff" strokeWidth="1.5" />
    </>
  );
};

const GraphSvg = ({ points, pathD, active, annotations, onSelect, width, height, hoveredIndex, onMouseMove, onMouseLeave, onClick }: any) => {
  const h = points.find((p: any) => p.index === hoveredIndex), d = h || active;
  return <svg width={width} height={height} className="overflow-visible select-none cursor-crosshair" onMouseMove={onMouseMove} onMouseLeave={onMouseLeave} onClick={onClick}>
    <GraphBg pathD={pathD} height={height} width={width} />
    <ActiveIndicator active={active} height={height} />
    <HoverIndicator hovered={h} activeIndex={active?.index} height={height} />
    {points.map((p: any, i: number) => <GraphDot key={i} p={p} activeIndex={active?.index} ann={annotations[p.index]} onSelect={onSelect} />)}
    {d && <GraphTooltip p={d} ann={annotations[d.index]} width={width} isHovered={!!h} />}
  </svg>;
};

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const obs = new ResizeObserver((es) => es[0] && setWidth(es[0].contentRect.width));
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return width;
}

function useGraphHover(points: any[], onSelect: (idx: number) => void) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setHoveredIndex(findClosestPoint(points, e.clientX - rect.left).index);
  };
  return { hoveredIndex, onMouseMove, onMouseLeave: () => setHoveredIndex(null), onClick: () => hoveredIndex !== null && onSelect(hoveredIndex) };
}

export function GameGraph({ annotations, currentIndex, onSelect }: Props) {
  const ref = useRef<HTMLDivElement | null>(null), w = useContainerWidth(ref), h = 120;
  const points = getPoints(annotations, w, h), active = points.find((p) => p.index === currentIndex);
  const hoverProps = useGraphHover(points, onSelect);
  return (
    <div ref={ref} className="w-full h-32 flex items-center overflow-visible">
      {w > 0 && <GraphSvg points={points} pathD={getPathD(points)} active={active} annotations={annotations} onSelect={onSelect} width={w} height={h} {...hoverProps} />}
    </div>
  );
}
