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

const getPoint = (ann: MoveAnnotation, i: number, total: number, width: number, height: number, lastY: number) => {
  if (ann.score === undefined) {
    const x = total > 1 ? ((i + 1) / total) * width : 0;
    return { x, y: lastY, index: i };
  }
  const coords = getPointCoords(i + 1, ann.score, total + 1, width, height);
  return { ...coords, index: i };
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

const getAnnotationDetail = (types?: string[]) => {
  if (!types || !types.length) return null;
  if (types.includes('blunder')) return { symbol: '??', bg: '#dc2626' };
  if (types.includes('mistake')) return { symbol: '?', bg: '#ea580c' };
  if (types.includes('brilliant')) return { symbol: '!!', bg: '#0d9488' };
  if (types.includes('book')) return { symbol: 'B', bg: '#2563eb' };
  return null;
};

const GraphDot = ({ p, activeIndex, ann, onSelect }: any) => {
  const detail = getAnnotationDetail(ann?.types);
  if (!detail || p.index === activeIndex) return null;
  return (
    <g className="cursor-pointer" onClick={() => onSelect(p.index)}>
      <circle cx={p.x} cy={p.y} r="9" fill={detail.bg} stroke="#18181b" strokeWidth="1.5" />
      <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central" fontSize="9px" fontWeight="black" fill="#ffffff" style={{ pointerEvents: 'none' }}>{detail.symbol}</text>
    </g>
  );
};

const GraphSvg = ({ points, pathD, active, annotations, onSelect, width, height }: any) => (
  <svg width={width} height={height} className="overflow-visible select-none">
    <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="#3f3f46" strokeDasharray="3,3" />
    {pathD && <path d={pathD} fill="none" stroke="#71717a" strokeWidth="2" />}
    {active && <line x1={active.x} y1={0} x2={active.x} y2={height} stroke="#3b82f6" strokeWidth="1" strokeDasharray="2,2" opacity="0.5" />}
    {active && <circle cx={active.x} cy={active.y} r="4" fill="#60a5fa" stroke="#ffffff" strokeWidth="1.5" />}
    {points.map((p: any, i: number) => <GraphDot key={i} p={p} activeIndex={active?.index} ann={annotations[p.index]} onSelect={onSelect} />)}
  </svg>
);

function useContainerWidth(ref: React.RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const obs = new ResizeObserver((es) => es[0] && setWidth(es[0].contentRect.width));
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return width;
}

export function GameGraph({ annotations, currentIndex, onSelect }: Props) {
  const ref = useRef<HTMLDivElement | null>(null), w = useContainerWidth(ref), h = 120;
  const points = getPoints(annotations, w, h);
  const active = points.find((p) => p.index === currentIndex);
  return (
    <div ref={ref} className="w-full h-32 flex items-center overflow-visible">
      {w > 0 && <GraphSvg points={points} pathD={getPathD(points)} active={active} annotations={annotations} onSelect={onSelect} width={w} height={h} />}
    </div>
  );
}
