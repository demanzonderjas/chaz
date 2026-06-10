// Simulate and test the date threshold calculation and SQL query builder

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}.${mm}.${dd}`;
}

function buildPuzzleSql(openingId, color, days) {
  let sql = `SELECT p.*, COALESCE(s.mistakes, 0) as mistakes FROM puzzles p JOIN games g ON p.game_id = g.id LEFT JOIN puzzle_stats s ON p.start_fen = s.start_fen WHERE p.type = ?`;
  const args = [];
  if (openingId !== undefined) { sql += ` AND g.opening_id = ?`; args.push(openingId); }
  if (color !== undefined) { sql += ` AND g.user_color = ?`; args.push(color); }
  if (days !== undefined) { sql += ` AND g.played_date >= ?`; args.push(getDateDaysAgo(days)); }
  sql += ` ORDER BY g.played_date DESC, g.id DESC LIMIT 150`;
  return { sql, args };
}

console.log("=== Testing getDateDaysAgo ===");
console.log("Date today:", new Date().toLocaleDateString());
console.log("Date 7 days ago format:", getDateDaysAgo(7));
console.log("Date 30 days ago format:", getDateDaysAgo(30));

console.log("\n=== Testing buildPuzzleSql ===");
console.log("Query with no filters:", buildPuzzleSql(undefined, undefined, undefined));
console.log("Query with 14 days filter:", buildPuzzleSql(undefined, undefined, 14));
console.log("Query with opening and 30 days filter:", buildPuzzleSql(12, 'w', 30));
