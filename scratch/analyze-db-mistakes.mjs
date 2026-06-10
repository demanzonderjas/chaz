import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { Chess } from 'chess.js';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

function normalizeFen(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

function getWinProbability(cp) {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

function getSideToMoveScore(ev) {
  if (ev.mate !== undefined && ev.mate !== null) {
    return ev.mate > 0 ? 10000 : -10000;
  }
  return ev.cp ?? ev.score ?? 0;
}

async function run() {
  console.log("Fetching puzzles...");
  const puzzlesRs = await client.execute(`
    SELECT p.id, p.game_id, p.start_fen, p.blunder_uci, p.type, p.player_color, p.description, g.pgn
    FROM puzzles p
    JOIN games g ON p.game_id = g.id
  `);

  console.log(`Analyzing ${puzzlesRs.rows.length} puzzles...`);

  // Collect all FENs to process
  const fensToQuery = new Set();
  const puzzlesToProcess = [];

  for (const row of puzzlesRs.rows) {
    if (row.type === 'weakness' || !row.blunder_uci) {
      continue;
    }

    const startFen = row.start_fen;
    const isOpp = row.description.toLowerCase().includes("opponent");

    let fenBefore = null;
    let fenAfter = null;

    try {
      if (isOpp) {
        // Opponent blundered. The puzzle start_fen is the position AFTER the blunder.
        // We need to reconstruct the position BEFORE the blunder.
        const chess = new Chess(startFen);
        // Since the opponent just moved, the blunder move is the last move played.
        // But the start_fen has the turn set to the user. We need to go back one move.
        // We can do this by loading the game pgn and finding where start_fen occurs.
        // A simpler way: we know the blunder_uci. Let's find the position before blunder.
        // Wait, since we can't easily go "backward" in chess.js without parsing the history,
        // let's fetch the game history to find the exact FENs.
        continue; // We'll handle this by fetching game history and matching FENs.
      } else {
        // User blundered. The puzzle start_fen is the position BEFORE the blunder.
        fenBefore = startFen;
        const chess = new Chess(startFen);
        chess.move({
          from: row.blunder_uci.slice(0, 2),
          to: row.blunder_uci.slice(2, 4),
          promotion: row.blunder_uci[4]
        });
        fenAfter = chess.fen();
      }
    } catch (e) {
      continue;
    }

    const normBefore = normalizeFen(fenBefore);
    const normAfter = normalizeFen(fenAfter);

    fensToQuery.add(normBefore);
    fensToQuery.add(normAfter);

    puzzlesToProcess.push({
      type: row.type,
      normBefore,
      normAfter,
      blunderUci: row.blunder_uci,
      gameId: row.game_id
    });
  }

  // To support both opponent and user blunders, let's load game history for all relevant games!
  const uniqueGameIds = Array.from(new Set(puzzlesRs.rows.map(r => r.game_id)));
  console.log(`Loading histories for ${uniqueGameIds.length} games to resolve all blunder transitions...`);
  
  const gamesMap = new Map();
  const gameChunkSize = 100;
  for (let i = 0; i < uniqueGameIds.length; i += gameChunkSize) {
    const chunk = uniqueGameIds.slice(i, i + gameChunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const rs = await client.execute({
      sql: `SELECT id, pgn FROM games WHERE id IN (${placeholders})`,
      args: chunk
    });
    rs.rows.forEach(r => {
      gamesMap.set(Number(r.id), String(r.pgn));
    });
  }

  const resolvedPuzzles = [];
  const allFensToQuery = new Set();

  for (const row of puzzlesRs.rows) {
    if (row.type === 'weakness' || !row.blunder_uci) continue;
    const pgn = gamesMap.get(row.game_id);
    if (!pgn) continue;

    try {
      const chess = new Chess();
      chess.loadPgn(pgn.replace(/\r\n/g, '\n').trim());
      const history = chess.history({ verbose: true });
      const fens = [chess.header().FEN || chess.header().Fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
      const temp = new Chess(fens[0]);
      for (const m of history) {
        temp.move(m.san);
        fens.push(temp.fen());
      }

      // Find the index i where history[i] is the blunder_uci
      const blunderUci = row.blunder_uci;
      let foundIndex = -1;
      for (let i = 0; i < history.length; i++) {
        const uci = history[i].from + history[i].to + (history[i].promotion || '');
        if (uci === blunderUci) {
          // Verify FEN matches
          const isOpp = row.description.toLowerCase().includes("opponent");
          const puzzleStartFen = row.start_fen;
          const targetFen = isOpp ? fens[i + 1] : fens[i];
          if (normalizeFen(puzzleStartFen) === normalizeFen(targetFen)) {
            foundIndex = i;
            break;
          }
        }
      }

      if (foundIndex !== -1) {
        const fenBefore = fens[foundIndex];
        const fenAfter = fens[foundIndex + 1];
        const normBefore = normalizeFen(fenBefore);
        const normAfter = normalizeFen(fenAfter);
        allFensToQuery.add(normBefore);
        allFensToQuery.add(normAfter);
        resolvedPuzzles.push({
          type: row.type,
          normBefore,
          normAfter
        });
      }
    } catch (e) {
      // ignore
    }
  }

  console.log(`Resolved ${resolvedPuzzles.length} puzzles. Querying ${allFensToQuery.size} distinct FENs...`);

  const fenList = Array.from(allFensToQuery);
  const evalMap = new Map();
  const chunkSize = 250;

  for (let i = 0; i < fenList.length; i += chunkSize) {
    const chunk = fenList.slice(i, i + chunkSize);
    const placeholders = chunk.map(() => '?').join(',');
    const sql = `
      SELECT fen_norm, result_json 
      FROM analysis 
      WHERE engine='sf18' 
        AND limit_type='depth' 
        AND multipv=4 
        AND fen_norm IN (${placeholders})
    `;
    const rs = await client.execute({ sql, args: chunk });
    rs.rows.forEach(r => {
      evalMap.set(r.fen_norm, JSON.parse(r.result_json));
    });
  }

  console.log(`Fetched ${evalMap.size} evaluations. Computing metrics...`);

  let analyzedCount = 0;
  let skippedCount = 0;
  const categories = {
    minor: 0,      // WP drop < 0.25
    moderate: 0,   // WP drop 0.25 - 0.35
    critical: 0,   // WP drop 0.35 - 0.50
    decisive: 0    // WP drop >= 0.50
  };

  const typeStats = {};

  for (const p of resolvedPuzzles) {
    const evBefore = evalMap.get(p.normBefore);
    const evAfter = evalMap.get(p.normAfter);

    if (!evBefore || !evAfter) {
      skippedCount++;
      continue;
    }

    const scoreBefore = getSideToMoveScore(evBefore);
    const scoreAfter = -getSideToMoveScore(evAfter);

    const wpBefore = getWinProbability(scoreBefore);
    const wpAfter = getWinProbability(scoreAfter);
    const wpDrop = wpBefore - wpAfter;
    const cpLoss = scoreBefore - scoreAfter;

    // Filter out edge cases where cpLoss is negative (engine instability)
    if (cpLoss < 0) {
      continue;
    }

    let severity = 'minor';
    if (wpDrop >= 0.50) severity = 'decisive';
    else if (wpDrop >= 0.35) severity = 'critical';
    else if (wpDrop >= 0.25) severity = 'moderate';

    categories[severity]++;
    analyzedCount++;

    if (!typeStats[p.type]) {
      typeStats[p.type] = { count: 0, totalWpDrop: 0, totalCpLoss: 0, decisiveCount: 0 };
    }
    typeStats[p.type].count++;
    typeStats[p.type].totalWpDrop += wpDrop;
    typeStats[p.type].totalCpLoss += cpLoss;
    if (severity === 'decisive' || severity === 'critical') {
      typeStats[p.type].decisiveCount++;
    }
  }

  console.log(`\n=== MISTAKE SEVERITY DISTRIBUTION (Blunderer Perspective) ===`);
  console.log(`Total Analyzed: ${analyzedCount}`);
  console.log(`Skipped (missing evaluations in DB): ${skippedCount}`);
  console.log(`- Minor Mistakes (WP drop < 25%): ${categories.minor} (${((categories.minor/analyzedCount)*100).toFixed(1)}%)`);
  console.log(`- Moderate Mistakes (WP drop 25% - 35%): ${categories.moderate} (${((categories.moderate/analyzedCount)*100).toFixed(1)}%)`);
  console.log(`- Critical Blunders (WP drop 35% - 50%): ${categories.critical} (${((categories.critical/analyzedCount)*100).toFixed(1)}%)`);
  console.log(`- Decisive Blunders (WP drop >= 50%): ${categories.decisive} (${((categories.decisive/analyzedCount)*100).toFixed(1)}%)`);

  console.log(`\n=== STATS BY PUZZLE TYPE ===`);
  for (const [type, stat] of Object.entries(typeStats)) {
    const avgWp = (stat.totalWpDrop / stat.count * 100).toFixed(1);
    const avgCp = (stat.totalCpLoss / stat.count).toFixed(0);
    const criticalPct = (stat.decisiveCount / stat.count * 100).toFixed(1);
    console.log(`${type}:`);
    console.log(`  Count: ${stat.count}`);
    console.log(`  Avg Win Prob Drop: ${avgWp}%`);
    console.log(`  Avg Centipawn Loss: ${avgCp} cp`);
    console.log(`  Critical/Decisive Blunders: ${stat.decisiveCount} (${criticalPct}%)`);
  }
}

run().catch(console.error);
