// Simulate the mate score parsing logic in stockfishScheduler.ts

function getMateScore(mateVal, color) {
  if (mateVal === 0) return color === 'w' ? -30000 : 30000;
  const sign = color === 'w' ? 1 : -1;
  return mateVal * sign > 0 ? 30000 : -30000;
}

function parseAnnotationScore(line, color, lastAnnotationScore) {
  const cpMatch = line.match(/score cp (-?\d+)/);
  if (cpMatch) return parseInt(cpMatch[1]) * (color === 'w' ? 1 : -1);
  const mateMatch = line.match(/score mate (-?\d+)/);
  if (mateMatch) return getMateScore(parseInt(mateMatch[1]), color);
  return lastAnnotationScore;
}

console.log("=== Testing parseAnnotationScore ===");

// 1. White is checkmated (color = 'w', score mate 0)
// Expected: -30000 (Black won, so White's score is -30000)
const line1 = "info depth 10 seldepth 12 score mate 0 pv e2e4";
console.log("White checkmated -> Expected: -30000, Got:", parseAnnotationScore(line1, 'w', 0));

// 2. Black is checkmated (color = 'b', score mate 0)
// Expected: 30000 (White won, so White's score is 30000)
const line2 = "info depth 10 seldepth 12 score mate 0 pv d7d5";
console.log("Black checkmated -> Expected: 30000, Got:", parseAnnotationScore(line2, 'b', 0));

// 3. Mate in 1 for White (color = 'w', score mate 1)
// Expected: 30000 (White mates in 1)
const line3 = "info depth 10 seldepth 12 score mate 1 pv e8e7";
console.log("White mates in 1 -> Expected: 30000, Got:", parseAnnotationScore(line3, 'w', 0));

// 4. Mate in 1 for Black (color = 'b', score mate 1)
// Expected: -30000 (Black mates in 1, so White is mated, score is negative)
console.log("Black mates in 1 -> Expected: -30000, Got:", parseAnnotationScore(line3, 'b', 0));

// 5. White getting mated in 1 (color = 'w', score mate -1)
// Expected: -30000
const line4 = "info depth 10 seldepth 12 score mate -1 pv f7f8q";
console.log("White getting mated in 1 -> Expected: -30000, Got:", parseAnnotationScore(line4, 'w', 0));

// 6. Black getting mated in 1 (color = 'b', score mate -1)
// Expected: 30000
console.log("Black getting mated in 1 -> Expected: 30000, Got:", parseAnnotationScore(line4, 'b', 0));
