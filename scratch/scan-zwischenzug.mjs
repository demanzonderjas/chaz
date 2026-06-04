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

function getSan(fen, uci) {
  try {
    const chess = new Chess(fen);
    const m = chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m ? m.san : uci;
  } catch {
    return uci;
  }
}

function getCandScore(cand) {
  if (cand.mate !== undefined && cand.mate !== null) {
    return cand.mate > 0 ? 10000 - cand.mate : -10000 - cand.mate;
  }
  return cand.cp ?? cand.score ?? 0;
}

function detectZwischenzug(startFen, bestUci, evalAtStart, prevMove) {
  if (!evalAtStart || !evalAtStart.candidates || evalAtStart.candidates.length === 0) {
    return null;
  }

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
            const isHighValue = ['q', 'r', 'b', 'n'].includes(piece.type);
            if (isHighValue || piece.type === 'p') {
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

  if (!isCapture && !isThreat) {
    return null;
  }

  const naturalMoves = [];
  const allLegalMoves = chess.moves({ verbose: true });

  if (isCapture && prevMove) {
    const captureSq = prevMove.to;
    allLegalMoves.forEach(m => {
      if (m.to === captureSq) {
        naturalMoves.push(m.from + m.to + (m.promotion || ''));
      }
    });
  } else if (isThreat && threatenedPieceSquare) {
    allLegalMoves.forEach(m => {
      if (m.from === threatenedPieceSquare) {
        naturalMoves.push(m.from + m.to + (m.promotion || ''));
      }
    });
  }

  if (naturalMoves.length === 0) {
    return null;
  }

  if (naturalMoves.includes(bestUci)) {
    return null;
  }

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
    } catch {
      return null;
    }
  }

  return null;
}

async function fetchCachedEvalsForFens(normFens) {
  if (normFens.length === 0) return {};
  const placeholders = normFens.map(() => '?').join(',');
  const sql = `SELECT fen_norm, result_json FROM analysis WHERE engine='sf18' AND limit_type='depth' AND multipv=4 AND fen_norm IN (${placeholders})`;
  const rs = await client.execute({ sql, args: normFens });
  const map = {};
  rs.rows.forEach(r => { map[String(r.fen_norm)] = JSON.parse(r.result_json); });
  return map;
}

function getGameFensAndHistory(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn.trim());
  const history = chess.history({ verbose: true });
  const fens = [chess.header().FEN || chess.header().Fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'];
  const temp = new Chess(fens[0]);
  for (const m of history) {
    temp.move(m.san);
    fens.push(temp.fen());
  }
  return { history, fens };
}

async function insertPuzzle(args, type = 'zwischenzug') {
  const sql = `INSERT OR IGNORE INTO puzzles (game_id, start_fen, solution_uci, solution_san, player_color, description, blunder_uci, blunder_san, game_title, type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const rs = await client.execute({ sql, args: [...args, type] });
  return rs.rowsAffected > 0;
}

async function run() {
  const gamesRs = await client.execute("SELECT id, pgn, white_name, black_name, result, user_color, played_date FROM games");
  console.log(`Found ${gamesRs.rows.length} games to scan.`);
  
  let insertedCount = 0;
  for (const game of gamesRs.rows) {
    const pgn = String(game.pgn);
    const black = String(game.black_name || '').toLowerCase();
    const uColor = (game.user_color) || (black.includes('demanzonderjas') ? 'b' : 'w');
    
    const { history, fens } = getGameFensAndHistory(pgn);
    const normFens = fens.map(normalizeFen);
    const evalMap = await fetchCachedEvalsForFens(normFens);
    
    for (let i = 0; i < history.length; i++) {
      const eb = evalMap[normFens[i]], ea = evalMap[normFens[i + 1]];
      if (!eb || !ea) continue;
      
      const isWhite = normFens[i].split(' ')[1] === 'w';
      const moveColor = isWhite ? 'w' : 'b';
      const isOpponent = moveColor !== uColor;
      
      const startFen = isOpponent ? fens[i + 1] : fens[i];
      const evalAtStart = isOpponent ? ea : eb;
      const bestUci = isOpponent ? ea.bestMove : eb.bestMove;
      const prevMove = isOpponent ? history[i] : (i > 0 ? history[i - 1] : null);
      
      if (bestUci) {
        const zw = detectZwischenzug(startFen, bestUci, evalAtStart, prevMove);
        if (zw) {
          const gameTitle = `${game.white_name} vs ${game.black_name} (${game.played_date})`;
          const desc = zw.isCapture
            ? `Opponent captured on ${prevMove.to}. Find the intermediate move (zwischenzug) instead of recapturing!`
            : `Opponent threatened your ${zw.threatenedPieceType === 'p' ? 'pawn' : zw.threatenedPieceType === 'q' ? 'queen' : zw.threatenedPieceType === 'r' ? 'rook' : zw.threatenedPieceType === 'b' ? 'bishop' : 'knight'}. Find the intermediate move (zwischenzug) instead of directly defending!`;
          
          const blunderUci = zw.naturalUci;
          const blunderSan = zw.naturalSan;
          
          const row = [game.id, startFen, bestUci, zw.solution_san, uColor, desc, blunderUci, blunderSan, gameTitle];
          const inserted = await insertPuzzle(row, 'zwischenzug');
          if (inserted) {
            console.log(`[Zwischenzug] Inserted puzzle for game ${game.id} at ply ${i}: solution ${zw.solution_san}, blunder/natural ${blunderSan}`);
            insertedCount++;
          }
        }
      }
    }
  }
  console.log(`Scan completed. Inserted ${insertedCount} new Zwischenzug puzzles.`);
}

run().catch(console.error);
