'use client';

import React, { useState, useEffect } from 'react';

interface Props {
  note: string;
  tags?: string[];
  placeholder: string;
  onSave: (note: string, tags: string[]) => Promise<void>;
  onClearArrows: () => Promise<void>;
  hasArrows: boolean;
  heightClass?: string;
}

export function PositionNotesInput({ note, tags = [], placeholder, onSave, onClearArrows, hasArrows, heightClass = 'h-16' }: Props) {
  const [val, setVal] = useState(note);
  const [selectedTags, setSelectedTags] = useState<string[]>(tags);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');
  const [showTagDropdown, setShowTagDropdown] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/tags').then(r => r.json()).then(d => {
      if (d.tags) setAvailableTags(d.tags);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    setVal(note);
    setSelectedTags(tags);
  }, [note, tags]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(val, selectedTags);
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
      
      const newAvailable = Array.from(new Set([...availableTags, ...selectedTags]));
      setAvailableTags(newAvailable);
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

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const newTag = tagInput.trim();
      if (newTag && !selectedTags.includes(newTag)) {
        setSelectedTags([...selectedTags, newTag]);
      }
      setTagInput('');
      setShowTagDropdown(false);
    } else if (e.key === 'Backspace' && tagInput === '' && selectedTags.length > 0) {
      setSelectedTags(selectedTags.slice(0, -1));
    }
  };

  const addTag = (tag: string) => {
    if (!selectedTags.includes(tag)) {
      setSelectedTags([...selectedTags, tag]);
    }
    setTagInput('');
    setShowTagDropdown(false);
  };

  const removeTag = (tag: string) => {
    setSelectedTags(selectedTags.filter(t => t !== tag));
  };

  const filteredTags = availableTags.filter(t => t.toLowerCase().includes(tagInput.toLowerCase()) && !selectedTags.includes(t));

  return (
    <div className="space-y-2 relative">
      <div className="flex flex-wrap items-center gap-1.5 p-1.5 bg-zinc-900 border border-zinc-800 rounded min-h-[32px]">
        {selectedTags.map(tag => (
          <span key={tag} className="flex items-center gap-1 bg-zinc-800 text-zinc-300 text-[10px] px-2 py-0.5 rounded-full border border-zinc-700">
            {tag}
            <button onClick={() => removeTag(tag)} className="text-zinc-500 hover:text-zinc-300 cursor-pointer">&times;</button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[120px]">
          <input
            type="text"
            value={tagInput}
            onChange={e => { setTagInput(e.target.value); setShowTagDropdown(true); }}
            onKeyDown={handleTagInputKeyDown}
            onFocus={() => setShowTagDropdown(true)}
            onBlur={() => setTimeout(() => setShowTagDropdown(false), 200)}
            placeholder={selectedTags.length === 0 ? "Add tags (e.g. blunder, missed-win)..." : ""}
            className="w-full bg-transparent text-[11px] text-zinc-200 focus:outline-none placeholder:text-zinc-600 font-sans"
          />
          {showTagDropdown && filteredTags.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-48 max-h-32 overflow-y-auto bg-zinc-800 border border-zinc-700 rounded shadow-lg z-10">
              {filteredTags.map(tag => (
                <div 
                  key={tag} 
                  className="px-2 py-1 text-xs text-zinc-300 hover:bg-blue-600 hover:text-white cursor-pointer"
                  onMouseDown={(e) => { e.preventDefault(); addTag(tag); }}
                >
                  {tag}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
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
