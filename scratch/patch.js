const fs = require('fs');

const path = 'app/components/ChessAnalysis.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. State addition
content = content.replace(
  "  const [activeBookNote, setActiveBookNote] = useState<string>('');",
  "  const [activeBookNote, setActiveBookNote] = useState<string>('');\n  const [activeBookTags, setActiveBookTags] = useState<string[]>([]);"
);

// 2. PositionSetters
content = content.replace(
  "type PositionSetters = {\n  setNote: (n: string) => void;\n  setLoaded: (a: Arrow[]) => void;",
  "type PositionSetters = {\n  setNote: (n: string) => void;\n  setTags: (t: string[]) => void;\n  setLoaded: (a: Arrow[]) => void;"
);

// 3. applyPosition
content = content.replace(
  "function applyPosition(comment: string, arrows: string, s: PositionSetters) {\n  s.setNote(comment);\n  s.setLoaded(parseArrows(arrows));",
  "function applyPosition(comment: string, tags: string[], arrows: string, s: PositionSetters) {\n  s.setNote(comment);\n  s.setTags(tags);\n  s.setLoaded(parseArrows(arrows));"
);

// 4. setActiveBookNote around 404
content = content.replace(
  "    setActiveBookNote(activeMove?.comment || '');\n    setLoadedArrows(parseArrows(activeMove?.arrows || ''));",
  "    setActiveBookNote(activeMove?.comment || '');\n    setActiveBookTags(activeMove?.tags || []);\n    setLoadedArrows(parseArrows(activeMove?.arrows || ''));"
);

// 5. autoSaveAnalysisArrows
content = content.replace(
  "          fen: boardFen,\n          comment: activeBookNote,\n          arrows: combined",
  "          fen: boardFen,\n          comment: activeBookNote,\n          tags: activeBookTags,\n          arrows: combined"
);

// 6. autoSaveArrows
content = content.replace(
  "          lineId: activeBookLine.id,\n          ply: activeMove.ply,\n          comment: activeBookNote,\n          arrows: combined",
  "          lineId: activeBookLine.id,\n          ply: activeMove.ply,\n          comment: activeBookNote,\n          tags: activeBookTags,\n          arrows: combined"
);

// 7. updateLocalBookLineState & saveBookNote
content = content.replace(
  "  const updateLocalBookLineState = (noteVal: string, combined: any[]) => {\n    setActiveBookNote(noteVal);\n    setLoadedArrows(",
  "  const updateLocalBookLineState = (noteVal: string, tagsVal: string[], combined: any[]) => {\n    setActiveBookNote(noteVal);\n    setActiveBookTags(tagsVal);\n    setLoadedArrows("
);
content = content.replace(
  "const updatedMoves = activeBookLine.moves.map((m: any, idx: number) => idx === activeBookMoveIdx ? { ...m, comment: noteVal, arrows: combined.length > 0 ? JSON.stringify(combined) : null } : m);",
  "const updatedMoves = activeBookLine.moves.map((m: any, idx: number) => idx === activeBookMoveIdx ? { ...m, comment: noteVal, tags: tagsVal, arrows: combined.length > 0 ? JSON.stringify(combined) : null } : m);"
);
content = content.replace(
  "  const saveBookNote = async (noteVal: string) => {\n    if (!activeBookLine || activeBookMoveIdx < 0) return;\n    const activeMove = activeBookLine.moves[activeBookMoveIdx];\n    const combined = getCombinedArrows();\n    const body = JSON.stringify({ lineId: activeBookLine.id, ply: activeMove.ply, comment: noteVal, arrows: combined });\n    const res = await fetch('/api/book-lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });\n    if (res.ok) updateLocalBookLineState(noteVal, combined);\n  };",
  "  const saveBookNote = async (noteVal: string, tagsVal: string[]) => {\n    if (!activeBookLine || activeBookMoveIdx < 0) return;\n    const activeMove = activeBookLine.moves[activeBookMoveIdx];\n    const combined = getCombinedArrows();\n    const body = JSON.stringify({ lineId: activeBookLine.id, ply: activeMove.ply, comment: noteVal, tags: tagsVal, arrows: combined });\n    const res = await fetch('/api/book-lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });\n    if (res.ok) updateLocalBookLineState(noteVal, tagsVal, combined);\n  };"
);

// 8. updateLocalPositionState & savePositionNote
content = content.replace(
  "  const updateLocalPositionState = (noteVal: string, combined: any[]) => {\n    setActiveBookNote(noteVal);\n    setLoadedArrows(",
  "  const updateLocalPositionState = (noteVal: string, tagsVal: string[], combined: any[]) => {\n    setActiveBookNote(noteVal);\n    setActiveBookTags(tagsVal);\n    setLoadedArrows("
);
content = content.replace(
  "const updatedMoves = relevantBookLine.moves.map((m: any, idx: number) => idx === bookLineActiveIdx ? { ...m, comment: noteVal, arrows: combined.length > 0 ? JSON.stringify(combined) : null } : m);",
  "const updatedMoves = relevantBookLine.moves.map((m: any, idx: number) => idx === bookLineActiveIdx ? { ...m, comment: noteVal, tags: tagsVal, arrows: combined.length > 0 ? JSON.stringify(combined) : null } : m);"
);
content = content.replace(
  "  const savePositionNote = async (noteVal: string) => {\n    const combined = getCombinedArrows();\n    const body = JSON.stringify({ fen: boardFen, comment: noteVal, arrows: combined });\n    const res = await fetch('/api/book-lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });\n    if (res.ok) updateLocalPositionState(noteVal, combined);\n  };",
  "  const savePositionNote = async (noteVal: string, tagsVal: string[]) => {\n    const combined = getCombinedArrows();\n    const body = JSON.stringify({ fen: boardFen, comment: noteVal, tags: tagsVal, arrows: combined });\n    const res = await fetch('/api/book-lines', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });\n    if (res.ok) updateLocalPositionState(noteVal, tagsVal, combined);\n  };"
);

// 9. useEffect around 798
content = content.replace(
  "const setters = { setNote: setActiveBookNote, setLoaded: setLoadedArrows, setDrawn: setDrawnArrows, setSuccess: setSaveNoteSuccess };",
  "const setters = { setNote: setActiveBookNote, setTags: setActiveBookTags, setLoaded: setLoadedArrows, setDrawn: setDrawnArrows, setSuccess: setSaveNoteSuccess };"
);
content = content.replace(
  "applyPosition(m.comment || '', m.arrows || '', setters);",
  "applyPosition(m.comment || '', m.tags || [], m.arrows || '', setters);"
);
content = content.replace(
  "applyPosition(d?.comment || '', d?.arrows || '', setters));",
  "applyPosition(d?.comment || '', d?.tags || [], d?.arrows || '', setters));"
);

// 10. PositionNotesInput usage
// First occurrence
content = content.replace(
  "                            <PositionNotesInput\n                              note={activeBookNote}\n                              placeholder=\"Add your notes about why this move is played...\"",
  "                            <PositionNotesInput\n                              note={activeBookNote}\n                              tags={activeBookTags}\n                              placeholder=\"Add your notes about why this move is played...\""
);
// Second occurrence
content = content.replace(
  "                <PositionNotesInput\n                  note={activeBookNote}\n                  placeholder=\"Save notes for this specific board position",
  "                <PositionNotesInput\n                  note={activeBookNote}\n                  tags={activeBookTags}\n                  placeholder=\"Save notes for this specific board position"
);

fs.writeFileSync(path, content, 'utf8');
console.log('Patched ChessAnalysis.tsx');
