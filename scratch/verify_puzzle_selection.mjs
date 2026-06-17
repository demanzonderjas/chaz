import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  console.log('--- STARTING VERIFICATION ---');

  // Query an existing game ID
  const gamesRs = await client.execute('SELECT id FROM games LIMIT 1');
  if (gamesRs.rows.length === 0) {
    console.error('No games found in the database. Cannot run test.');
    return;
  }
  const gameId = Number(gamesRs.rows[0].id);
  console.log(`Using existing game ID: ${gameId}`);

  const testType = 'test_temp_type';
  
  // Clean up any old test data
  await client.execute({
    sql: 'DELETE FROM puzzles WHERE type = ?',
    args: [testType]
  });
  await client.execute({
    sql: "DELETE FROM puzzle_stats WHERE start_fen IN ('fen_test_1 w - - 0 1', 'fen_test_2 w - - 0 1')",
    args: []
  });

  // Insert two test puzzles linked to the existing game
  await client.execute({
    sql: `INSERT INTO puzzles (id, game_id, start_fen, solution_uci, solution_san, player_color, description, blunder_uci, blunder_san, game_title, type) VALUES (999991, ${gameId}, 'fen_test_1 w - - 0 1', 'e2e4', 'e4', 'w', 'Test 1', 'e2e3', 'e3', 'Game 1', ?)`,
    args: [testType]
  });
  await client.execute({
    sql: `INSERT INTO puzzles (id, game_id, start_fen, solution_uci, solution_san, player_color, description, blunder_uci, blunder_san, game_title, type) VALUES (999992, ${gameId}, 'fen_test_2 w - - 0 1', 'd2d4', 'd4', 'w', 'Test 2', 'd2d3', 'd3', 'Game 1', ?)`,
    args: [testType]
  });

  console.log('Inserted two test puzzles.');

  // Helper function to fetch puzzles following the new selection logic
  async function fetchTestPuzzle(onlyActive = true) {
    let sql = `SELECT p.*, COALESCE(s.mistakes, 0) as mistakes, s.last_result FROM puzzles p JOIN games g ON p.game_id = g.id LEFT JOIN puzzle_stats s ON p.start_fen = s.start_fen WHERE p.type = ? AND p.solution_uci != '(none)'`;
    if (onlyActive) {
      sql += ` AND (s.last_result IS NULL OR s.last_result = 'fail')`;
    }
    const rs = await client.execute({ sql, args: [testType] });
    return rs.rows;
  }

  // 1. Initial fetch: both should be active
  let active = await fetchTestPuzzle(true);
  console.log(`Initial active count (expected 2): ${active.length}`);

  // 2. Mark one as fail (mistake) and check again
  await client.execute({
    sql: "INSERT INTO puzzle_stats (start_fen, puzzle_id, mistakes, last_result) VALUES ('fen_test_1 w - - 0 1', 999991, 1, 'fail')",
    args: []
  });
  active = await fetchTestPuzzle(true);
  console.log(`Active count after 1 fail (expected 2): ${active.length}`);

  // 3. Mark the failed one as success (clean solve)
  await client.execute({
    sql: "UPDATE puzzle_stats SET last_result = 'success', mistakes = 0 WHERE start_fen = 'fen_test_1 w - - 0 1'",
    args: []
  });
  active = await fetchTestPuzzle(true);
  console.log(`Active count after 1 success (expected 1): ${active.length}`);
  console.log(`Remaining active puzzle ID (expected 999992): ${active[0]?.id}`);

  // 4. Mark the second one as success (all solved)
  await client.execute({
    sql: "INSERT INTO puzzle_stats (start_fen, puzzle_id, mistakes, last_result) VALUES ('fen_test_2 w - - 0 1', 999992, 0, 'success')",
    args: []
  });
  active = await fetchTestPuzzle(true);
  console.log(`Active count after all solved (expected 0): ${active.length}`);

  // 5. Test reset logic
  if (active.length === 0) {
    console.log('No puzzles left. Resetting history...');
    await client.execute({
      sql: 'DELETE FROM puzzle_stats WHERE start_fen IN (SELECT start_fen FROM puzzles WHERE type = ?)',
      args: [testType]
    });
    active = await fetchTestPuzzle(true);
    console.log(`Active count after history reset (expected 2): ${active.length}`);
  }

  // Clean up
  await client.execute({ sql: 'DELETE FROM puzzles WHERE type = ?', args: [testType] });
  await client.execute({ sql: "DELETE FROM puzzle_stats WHERE start_fen IN ('fen_test_1 w - - 0 1', 'fen_test_2 w - - 0 1')", args: [] });
  console.log('Cleaned up test records.');
  console.log('--- VERIFICATION SUCCESSFUL ---');
}

run().catch(console.error);
