import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { Chess } from 'chess.js';

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

function normalizeBookFen(fen) {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

function getSan(fen, uci) {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m ? m.san : uci;
  } catch {
    return uci;
  }
}

function getGamePlyForFen(pgn, targetFen3) {
  const chess = new Chess();
  try {
    chess.loadPgn(pgn.trim());
    const history = chess.history({ verbose: true });
    const startFen = chess.header().FEN || chess.header().Fen || STARTING_FEN;
    const temp = new Chess(startFen);
    
    const startParts = temp.fen().split(' ');
    const start3 = `${startParts[0]} ${startParts[1]} ${startParts[2]}`;
    if (start3 === targetFen3) {
      return 0;
    }

    let ply = 0;
    for (const m of history) {
      temp.move(m.san);
      ply++;
      const parts = temp.fen().split(' ');
      const p3 = `${parts[0]} ${parts[1]} ${parts[2]}`;
      if (p3 === targetFen3) {
        return ply;
      }
    }
  } catch (e) {
    // ignore
  }
  return -1;
}

async function testFetchWeakness() {
  console.log("Testing fetchWeaknessPuzzle() logic...");

  // 1. Fetch random weak moves
  const pmSql = `
    SELECT fen_norm, uci, san, wins, draws, losses, game_id
    FROM position_moves
    WHERE game_id IS NOT NULL AND (losses > wins OR losses >= 2)
    ORDER BY RANDOM()
    LIMIT 200
  `;
  const pmRs = await client.execute(pmSql);
  console.log(`Fetched ${pmRs.rows.length} candidate weak moves.`);
  if (pmRs.rows.length === 0) {
    console.log("No weak moves found!");
    return;
  }

  // 2. Map FENs
  const fenMap = new Map();
  const fensToQuery = [];
  pmRs.rows.forEach(row => {
    const fen4 = String(row.fen_norm) + ' -';
    fensToQuery.push(fen4);
    fenMap.set(fen4, row);
  });

  // 3. Query analysis
  const placeholders = fensToQuery.map(() => '?').join(',');
  const analysisSql = `
    SELECT fen_norm, result_json
    FROM analysis
    WHERE engine = 'sf18'
      AND limit_type = 'depth'
      AND multipv = 4
      AND fen_norm IN (${placeholders})
  `;
  const aRs = await client.execute({ sql: analysisSql, args: fensToQuery });
  console.log(`Matched ${aRs.rows.length} rows in analysis.`);

  // 4. Form candidate list
  let candidates = [];
  for (const aRow of aRs.rows) {
    const fen4 = String(aRow.fen_norm);
    const evalData = JSON.parse(aRow.result_json);
    const pmRow = fenMap.get(fen4);
    if (!pmRow) continue;

    const bestMove = evalData.bestMove;
    const playedUci = String(pmRow.uci);

    if (bestMove && bestMove !== playedUci) {
      candidates.push({
        fen: fen4,
        playedUci,
        playedSan: String(pmRow.san),
        engineBestMove: bestMove,
        wins: Number(pmRow.wins || 0),
        draws: Number(pmRow.draws || 0),
        losses: Number(pmRow.losses || 0),
        gameId: Number(pmRow.game_id),
        evalData,
        mistakes: 0 // dummy for test
      });
    }
  }
  console.log(`Found ${candidates.length} candidate moves with engine deviations.`);

  if (candidates.length === 0) return;

  // 5. Select a candidate, check ply >= 6, retry if not met
  let loopCount = 0;
  while (candidates.length > 0) {
    loopCount++;
    let totalWeight = 0;
    const poolWithWeights = candidates.map(c => {
      const weakness = Math.max(1, c.losses - c.wins);
      const weight = weakness * (1 + c.mistakes * 5);
      totalWeight += weight;
      return { c, weight };
    });

    let randomVal = Math.random() * totalWeight;
    let selectedIndex = 0;
    for (let i = 0; i < poolWithWeights.length; i++) {
      randomVal -= poolWithWeights[i].weight;
      if (randomVal <= 0) {
        selectedIndex = i;
        break;
      }
    }
    const selected = poolWithWeights[selectedIndex].c;

    // Fetch game to verify ply >= 6
    const gameRs = await client.execute({
      sql: 'SELECT id, pgn, white_name, black_name, result, user_color, played_date FROM games WHERE id = ?',
      args: [selected.gameId]
    });
    const game = gameRs.rows[0];
    if (!game) {
      candidates.splice(selectedIndex, 1);
      continue;
    }

    const pgn = String(game.pgn);
    const fen3 = selected.fen.split(' ').slice(0, 3).join(' ');
    const ply = getGamePlyForFen(pgn, fen3);

    if (ply < 6) {
      console.log(`Skipping candidate at game ${game.id} due to low ply: ${ply}`);
      candidates.splice(selectedIndex, 1);
      continue;
    }

    // Success!
    const turn = selected.fen.split(' ')[1];
    const solutionSan = getSan(selected.fen, selected.engineBestMove);
    const gameTitle = `${game.white_name} vs ${game.black_name} (${game.played_date})`;
    const description = `You played ${selected.playedSan} in the game which led to a loss. Find the best move!`;

    const puzzle = {
      id: -300000 - selected.gameId * 100,
      type: 'weakness',
      game_id: selected.gameId,
      start_fen: selected.fen,
      solution_uci: selected.engineBestMove,
      solution_san: solutionSan,
      player_color: turn,
      description,
      blunder_uci: selected.playedUci,
      blunder_san: selected.playedSan,
      game_title: gameTitle
    };

    console.log(`Successfully fetched weakness puzzle after ${loopCount} iterations!`);
    console.log("Puzzle details:", puzzle);
    console.log(`Confirmed Ply: ${ply} (should be >= 6)`);
    break;
  }
}

testFetchWeakness().catch(console.error);
