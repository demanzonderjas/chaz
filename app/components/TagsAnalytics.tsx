'use client';

import React, { useState, useEffect } from 'react';

export function TagsAnalytics() {
  const [data, setData] = useState<{ tag: string; date: string; occurrences: number }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tags?analytics=true')
      .then(r => r.json())
      .then(d => {
        if (d.analytics) setData(d.analytics);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4 font-sans animate-pulse">
        <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Mistakes Over Time</h2>
        <div className="h-40 bg-zinc-800/50 rounded flex items-center justify-center text-xs text-zinc-500">Loading analytics...</div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4 font-sans">
        <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Mistakes Over Time</h2>
        <div className="text-zinc-550 text-xs italic py-6 text-center">No tagged mistakes found in your games yet. Tag some mistakes in analysis mode!</div>
      </div>
    );
  }

  // Group data by tag
  const tagsMap = new Map<string, number>();
  data.forEach(d => {
    tagsMap.set(d.tag, (tagsMap.get(d.tag) || 0) + d.occurrences);
  });

  const sortedTags = Array.from(tagsMap.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <div className="bg-zinc-900/10 border border-zinc-900 rounded-xl p-5 space-y-4 font-sans">
      <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Mistakes Over Time</h2>
      
      <div className="space-y-4 pt-2">
        {sortedTags.map(([tag, total]) => {
          // Find occurrences by month for this tag
          const tagData = data.filter(d => d.tag === tag);
          // Group by Month (YYYY-MM)
          const monthMap = new Map<string, number>();
          tagData.forEach(d => {
            const month = d.date.substring(0, 7); // e.g. 2023-10
            monthMap.set(month, (monthMap.get(month) || 0) + d.occurrences);
          });
          
          const sortedMonths = Array.from(monthMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
          
          return (
            <div key={tag} className="border-t border-zinc-900/50 pt-3 first:border-0 first:pt-0">
              <div className="flex justify-between items-end mb-2">
                <span className="text-xs font-bold text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">{tag}</span>
                <span className="text-[10px] text-zinc-500 font-mono">Total: {total}</span>
              </div>
              
              <div className="flex gap-1 h-12 items-end mt-2 overflow-x-auto pb-1 no-scrollbar">
                {sortedMonths.map(([month, count]) => {
                  // Max height 100% for the highest count in this tag
                  const maxCount = Math.max(...Array.from(monthMap.values()));
                  const heightPct = Math.max((count / maxCount) * 100, 10);
                  return (
                    <div key={month} className="flex flex-col items-center gap-1 group relative flex-1 min-w-[20px]">
                      <div className="w-full bg-blue-500/50 hover:bg-blue-400 rounded-sm transition-colors" style={{ height: `${heightPct}%` }} />
                      <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-1 bg-zinc-800 text-white text-[9px] px-1.5 py-0.5 rounded whitespace-nowrap z-10 pointer-events-none">
                        {month}: {count}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
