async function test() {
  console.log("Fetching an endgame puzzle...");
  const res = await fetch("http://localhost:3000/api/puzzles?type=endgame");
  if (!res.ok) {
    console.error("Failed to fetch puzzle:", res.statusText);
    return;
  }
  const data = await res.json();
  const puzzle = data.puzzle || data;
  const evaluation = data.evaluation;
  const blunderEvaluation = data.blunderEvaluation;
  
  console.log("\nPuzzle Title:", puzzle.game_title);
  console.log("Description:", puzzle.description);
  console.log("Puzzle Type:", puzzle.type);
  console.log("Solution UCI:", puzzle.solution_uci);
  console.log("Blunder UCI:", puzzle.blunder_uci);
  console.log("Has Before Evaluation:", !!evaluation);
  console.log("Has After/Blunder Evaluation:", !!blunderEvaluation);
  if (evaluation && blunderEvaluation) {
    const getScore = (ev) => {
      const best = ev.candidates?.[0] ?? ev;
      return best.cp ?? best.score ?? 0;
    };
    const bestScore = getScore(evaluation);
    const blunderScore = -getScore(blunderEvaluation);
    console.log("Best Score:", bestScore);
    console.log("Blunder Score:", blunderScore);
    console.log("Eval Drop Difference:", bestScore - blunderScore);
  }
}

test().catch(console.error);
