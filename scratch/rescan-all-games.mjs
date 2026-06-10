import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { Chess } from 'chess.js';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

function normalizeFen(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

function normalizeBookFen(fen) {
  const p = fen.split(' ');
  return `${p[0]} ${p[1]} ${p[2]} -`;
}

function getWinProbability(cp) {
  return 1 / (1 + Math.pow(10, -cp / 400));
}

function preprocessPgn(pgn) {
  return pgn.replace(/\r\n/g, '\n');
}

function isUserBlack(blackName) {
  const name = blackName.toLowerCase();
  return name.includes('demanzonderjas');
}

function isEndgameFen(fen) {
  const board = fen.split(' ')[0];
  const pieces = board.match(/[qrbnQRBN]/g);
  return !pieces || pieces.length <= 4;
}

function getSideToMoveScore(ev) {
  if (ev.mate !== undefined && ev.mate !== null) {
    return ev.mate > 0 ? 10000 : -10000;
  }
  return ev.cp ?? ev.score ?? 0;
}

function getPuzzleType(fen, ply, isOpp, ev) {
  if (isEndgameFen(fen)) return 'endgame';
  const score = getSideToMoveScore(ev);
  if (score >= 200) return 'winning_position';
  if (ply <= 24 && !isOpp && score >= -150) return 'opening';
  return score >= -350 && score <= -100 ? 'defensive' : 'tactical';
}

function getPuzzleDescription(type, isOpp, san) {
  if (type === 'endgame') return isOpp ? `Opponent blundered. Find the winning endgame technique!` : `Endgame challenge: Find the best move to convert this endgame!`;
  if (type === 'winning_position') return isOpp ? `Opponent blundered. Find the clinical winning sequence!` : `You had a winning position. Find the correct winning move!`;
  if (type === 'opening') return `Opening challenge: Find the correct move to get a playable game out of the opening!`;
  if (type === 'defensive') return isOpp ? `Opponent threatened you. Find the precise defensive response to hold the game!` : `You were under pressure. Find the precise saving move!`;
  return isOpp ? `Opponent played ${san}. Find the winning response!` : `You played ${san} in the game. Find the correct move instead!`;
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

function detectBlunderDetails(evalBefore, evalAfter, isWhiteToMove, ply) {
  const scoreBefore = isWhiteToMove ? evalBefore.cp : -evalBefore.cp;
  const scoreAfter = isWhiteToMove ? evalAfter.cp : -evalAfter.cp;
  if (scoreBefore === undefined || scoreAfter === undefined) return null;
  const wpBefore = getWinProbability(scoreBefore);
  const wpAfter = getWinProbability(-scoreAfter);
  const threshold = (ply !== undefined && ply <= 24) ? 0.10 : 0.20;
  return wpBefore - wpAfter >= threshold ? { scoreBefore, scoreAfter } : null;
}

function detectZwischenzug(startFen, bestUci, evalAtStart, prevMove) {
  if (!evalAtStart || !evalAtStart.candidates || evalAtStart.candidates.length === 0) return null;
  const isCapture = prevMove && (prevMove.captured !== undefined || prevMove.san.includes('x'));
  const chess = new Chess(startFen);
  const colorToMove = chess.turn();
  const opponentColor = colorToMove === 'w' ? 'b' : 'w';

  let isThreat = false;
  let threatenedPieceSquare = null;
  let threatenedPieceType = null;

  if (!isCapture) {
    const ranks = ['1', '2', '3', '4', '5', '6', '7', '8'];
    const files = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    for (const r of ranks) {
      for (const f of files) {
        const sq = f + r;
        const piece = chess.get(sq);
        if (piece && piece.color === colorToMove) {
          if (chess.isAttacked(sq, opponentColor)) {
            if (['q', 'r', 'b', 'n'].includes(piece.type) || piece.type === 'p') {
              isThreat = true;
              threatenedPieceSquare = sq;
              threatenedPieceType = piece.type;
              break;
            }
          }
        }
      }
      if (isThreat) break;
    }
  }

  if (!isCapture && !isThreat) return null;

  const naturalMoves = [];
  const allLegalMoves = chess.moves({ verbose: true });

  if (isCapture && prevMove) {
    const captureSq = prevMove.to;
    allLegalMoves.forEach(m => {
      if (m.to === captureSq) naturalMoves.push(m.from + m.to + (m.promotion || ''));
    });
  } else if (isThreat && threatenedPieceSquare) {
    allLegalMoves.forEach(m => {
      if (m.from === threatenedPieceSquare) naturalMoves.push(m.from + m.to + (m.promotion || ''));
    });
  }

  if (naturalMoves.length === 0 || naturalMoves.includes(bestUci)) return null;

  const bestCand = evalAtStart.candidates[0];
  const bestScore = getCandScore(bestCand);

  let naturalScore = null;
  for (const cand of evalAtStart.candidates) {
    if (naturalMoves.includes(cand.bestMove)) {
      naturalScore = getCandScore(cand);
      break;
    }
  }

  if (naturalScore === null) {
    const worstCand = evalAtStart.candidates[evalAtStart.candidates.length - 1];
    naturalScore = getCandScore(worstCand) - 50;
  }

  if (bestScore - naturalScore >= 150) {
    const testChess = new Chess(startFen);
    try {
      const moveResult = testChess.move({
        from: bestUci.slice(0, 2),
        to: bestUci.slice(2, 4),
        promotion: bestUci[4]
      });
      const isForcing = testChess.inCheck() || moveResult.captured || moveResult.san.includes('+') || moveResult.san.includes('#');
      if (isForcing || bestScore - naturalScore >= 200) {
        return {
          solution_san: moveResult ? moveResult.san : bestUci,
          naturalUci: naturalMoves[0],
          naturalSan: getSan(startFen, naturalMoves[0]),
          isCapture,
          threatenedPieceType,
          threatenedPieceSquare,
          bestScore,
          naturalScore
        };
      }
    } catch { return null; }
  }
  return null;
}

function getCandScore(cand) {
  if (cand.mate !== undefined && cand.mate !== null) {
    return cand.mate > 0 ? 10000 - cand.mate : -10000 - cand.mate;
  }
  return cand.cp ?? cand.score ?? 0;
}

async function run() {
  console.log("Clearing all puzzles from the database...");
  await client.execute("DELETE FROM puzzles");

  console.log("Fetching all games...");
  const gamesRs = await client.execute("SELECT id, pgn, white_name, black_name, result, user_color, played_date FROM games");
  console.log(`Found ${gamesRs.rows.length} games. Starting rescan...`);

  let puzzlesInserted = 0;

  for (const game of gamesRs.rows) {
    const pgn = String(game.pgn);
    const black = String(game.black_name || '');
    const uColor = String(game.user_color || (isUserBlack(black) ? 'b' : 'w'));

    const chess = new Chess();
    try {
      chess.loadPgn(preprocessPgn(pgn).trim());
    } catch {
      continue;
    }
    const history = chess.history({ verbose: true });
    
    const fens = [chess.header().FEN || chess.header().Fen || STARTING_FEN];
    const temp = new Chess(fens[0]);
    for (const m of history) {
      temp.move(m.san);
      fens.push(temp.fen());
    }

    const normFens = fens.map(normalizeFen);
    
    // Fetch cached evals for these Fens
    const placeholders = normFens.map(() => '?').join(',');
    const sql = `SELECT fen_norm, result_json FROM analysis WHERE engine='sf18' AND limit_type='depth' AND multipv=4 AND fen_norm IN (${placeholders})`;
    const rs = await client.execute({ sql, args: normFens });
    const evalMap = {};
    rs.rows.forEach(r => { evalMap[String(r.fen_norm)] = JSON.parse(r.result_json); });

    // Fetch book moves for these fens
    const bookFens = fens.map(normalizeBookFen);
    const bmPlaceholders = bookFens.map(() => '?').join(',');
    const bmRs = await client.execute({
      sql: `SELECT fen_before, uci FROM book_moves WHERE fen_before IN (${bmPlaceholders})`,
      args: bookFens
    });
    const bookMoves = new Set();
    bmRs.rows.forEach(r => bookMoves.add(`${r.fen_before}|${r.uci}`));

    for (let i = 0; i < history.length; i++) {
      const eb = evalMap[normFens[i]], ea = evalMap[normFens[i + 1]];
      if (!eb || !ea) continue;

      const isWhite = normFens[i].split(' ')[1] === 'w';
      const p = detectBlunderDetails(eb, ea, isWhite, i);
      if (!p) continue;

      const moveColor = isWhite ? 'w' : 'b';
      const isOpponent = moveColor !== uColor;
      const startFen = isOpponent ? fens[i + 1] : fens[i];
      const evalAtStart = isOpponent ? ea : eb;
      const bestUci = isOpponent ? ea.bestMove : eb.bestMove;
      if (!bestUci) continue;

      const prevMove = isOpponent ? history[i] : (i > 0 ? history[i - 1] : null);
      const zw = detectZwischenzug(startFen, bestUci, evalAtStart, prevMove);
      if (zw) {
        const gameTitle = `${game.white_name} vs ${game.black_name} (${game.played_date})`;
        const desc = zw.isCapture
          ? `Opponent captured on ${prevMove.to}. Find the intermediate move (zwischenzug) instead of recapturing!`
          : `Opponent threatened your ${zw.threatenedPieceType === 'p' ? 'pawn' : zw.threatenedPieceType === 'q' ? 'queen' : zw.threatenedPieceType === 'r' ? 'rook' : zw.threatenedPieceType === 'b' ? 'bishop' : 'knight'}. Find the intermediate move (zwischenzug) instead of directly defending!`;
        await client.execute({
          sql: `INSERT OR IGNORE INTO puzzles (game_id, start_fen, solution_uci, solution_san, player_color, description, blunder_uci, blunder_san, game_title, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [game.id, startFen, bestUci, zw.solution_san, uColor, desc, zw.naturalUci, zw.naturalSan, gameTitle, 'zwischenzug']
        });
        puzzlesInserted++;
        continue;
      }

      const blunderUci = history[i].from + history[i].to + (history[i].promotion || '');
      if (bookMoves.has(`${normalizeBookFen(fens[i])}|${blunderUci}`)) continue;
      const blunderSan = history[i].san;
      const gameTitle = `${game.white_name} vs ${game.black_name} (${game.played_date})`;

      const puzzleType = getPuzzleType(startFen, i, isOpponent, evalAtStart);
      const desc = getPuzzleDescription(puzzleType, isOpponent, blunderSan);
      await client.execute({
        sql: `INSERT OR IGNORE INTO puzzles (game_id, start_fen, solution_uci, solution_san, player_color, description, blunder_uci, blunder_san, game_title, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [game.id, startFen, bestUci, getSan(startFen, bestUci), uColor, desc, blunderUci, blunderSan, gameTitle, puzzleType]
      });
      puzzlesInserted++;
    }
  }

  console.log(`Scan completed. Inserted/Updated ${puzzlesInserted} puzzles in total.`);

  // Print counts for each type of puzzle in the database
  const countsRs = await client.execute("SELECT type, COUNT(*) as cnt FROM puzzles GROUP BY type");
  console.log("\nPuzzle counts by type in database:");
  countsRs.rows.forEach(r => {
    console.log(`  ${r.type}: ${r.cnt}`);
  });
}

run().catch(console.error);
