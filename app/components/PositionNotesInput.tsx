'use client';

import React, { useState, useEffect } from 'react';

interface Props {
  note: string;
  placeholder: string;
  onSave: (note: string) => Promise<void>;
  onClearArrows: () => Promise<void>;
  hasArrows: boolean;
  heightClass?: string;
}

export function PositionNotesInput({ note, placeholder, onSave, onClearArrows, hasArrows, heightClass = 'h-16' }: Props) {
  const [val, setVal] = useState(note);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setVal(note);
  }, [note]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(val);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="space-y-2">
      <textarea
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={`w-full ${heightClass} bg-zinc-900 border border-zinc-800 rounded p-1.5 text-xs font-sans resize-none focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-200`}
      />
      <div className="flex justify-end items-center gap-2">
        {hasArrows && (
          <button
            onClick={onClearArrows}
            className="text-[10px] px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-750 border border-zinc-700 text-zinc-300 cursor-pointer mr-auto"
          >
            Clear Arrows
          </button>
        )}
        {success && <span className="text-[10px] text-emerald-450 font-semibold animate-pulse">✓ Saved!</span>}
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors disabled:opacity-50 cursor-pointer"
        >
          {saving ? 'Saving...' : 'Save Notes'}
        </button>
      </div>
    </div>
  );
}
