function getWinProbability(cp) {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

function getSideToMoveScore(ev) {
  if (ev.mate !== undefined && ev.mate !== null) {
    return ev.mate > 0 ? 10000 : -10000;
  }
  return ev.cp ?? ev.score ?? 0;
}

async function test() {
  console.log("Fetching a tactical puzzle...");
  const res = await fetch("http://localhost:3000/api/puzzles?type=tactical");
  if (!res.ok) {
    console.error("Failed to fetch puzzle:", res.statusText);
    return;
  }
  const data = await res.json();
  const puzzle = data.puzzle || data;
  const evaluation = data.evaluation;
  
  if (!evaluation) {
    console.log("No evaluation returned with puzzle.");
    return;
  }

  console.log("\nPuzzle Title:", puzzle.game_title);
  console.log("Description:", puzzle.description);
  console.log("Puzzle Type:", puzzle.type);
  
  // The puzzle evaluation field contains the evaluation before the blunder (bestMove evaluation)
  // or after the blunder (depending on user/opponent perspective). Let's print it.
  console.log("Evaluation JSON:", JSON.stringify(evaluation, null, 2));
}

test().catch(console.error);
