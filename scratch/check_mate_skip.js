import { createClient } from '@libsql/client';
const turso = createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN });
function getSideToMoveScore(ev) {
  if (ev.mate !== undefined && ev.mate !== null) return ev.mate > 0 ? 10000 : -10000;
  return ev.cp ?? ev.score ?? 0;
}
function getWinProbability(score) { return 1 / (1 + Math.exp(-0.00368208 * score)); }

async function run() {
  const rs = await turso.execute("SELECT fen_norm, result_json FROM analysis WHERE result_json LIKE '%\"mate\":%'");
  let foundBlunders = 0;
  for (const row of rs.rows) {
    const ea = JSON.parse(row.result_json);
    if (ea.mate === 30000 || (ea.mate > 0 && ea.mate <= 9)) {
       // This is a position where the person to move has a forced mate.
       // It could be that the PREVIOUS move blundered into this.
       // Let's find the previous move's eval!
       const sql = "SELECT result_json FROM analysis WHERE fen_norm IN (SELECT fen_norm FROM position_moves WHERE uci = ?) LIMIT 1"; 
       // hard to do without the game history
    }
  }
}
run();
