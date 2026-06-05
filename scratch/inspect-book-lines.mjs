import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

function classifyByMoves(moves) {
  const moveStr = moves.map(m => m.uci).join(' ');
  
  // Sicilian Defense: 1. e4 c5
  if (moveStr.startsWith('e2e4 c7c5')) return 'Sicilian Defence';
  // French Defense: 1. e4 e6
  if (moveStr.startsWith('e2e4 e7e6')) return 'French Defence';
  // Caro-Kann Defense: 1. e4 c6
  if (moveStr.startsWith('e2e4 c7c6')) return 'Caro-Kann Defence';
  // Scandinavian Defense: 1. e4 d5
  if (moveStr.startsWith('e2e4 d7d5')) return 'Scandinavian Defence';
  // Nimzowitsch Defense: 1. e4 Nc6
  if (moveStr.startsWith('e2e4 b8c6')) return 'Nimzowitsch Defence';
  // Pirc / Modern: 1. e4 d6 or 1. e4 g6
  if (moveStr.startsWith('e2e4 d7d6') || moveStr.startsWith('e2e4 g7g6')) {
    return 'Pirc / Modern Defence';
  }
  // Alekhine Defense: 1. e4 Nf6
  if (moveStr.startsWith('e2e4 g8f6')) return 'Alekhine Defence';
  // Ruy Lopez: 1. e4 e5 2. Nf3 Nc6 3. Bb5
  if (moveStr.startsWith('e2e4 e7e5 g1f3 b8c6 f1b5')) return 'Ruy Lopez';
  // Italian Game: 1. e4 e5 2. Nf3 Nc6 3. Bc4
  if (moveStr.startsWith('e2e4 e7e5 g1f3 b8c6 f1c4')) return 'Italian Game';
  
  // London System: 1. d4 ... Bf4
  if (moveStr.startsWith('d2d4') && moves.some(m => m.uci === 'c1f4' || m.uci === 'c1f4')) return 'London System';
  // Queen's Gambit: 1. d4 d5 2. c4
  if (moveStr.startsWith('d2d4 d7d5 c2c4')) return 'Queen\'s Gambit';
  // King's Indian / Grunfeld: 1. d4 Nf6 2. c4 g6
  if (moveStr.startsWith('d2d4 g8f6 c2c4 g7g6')) return 'King\'s Indian / Grunfeld';
  // Nimzo-Indian / Queen's Indian: 1. d4 Nf6 2. c4 e6
  if (moveStr.startsWith('d2d4 g8f6 c2c4 e7e6')) return 'Indian Defences';
  // Dutch Defense: 1. d4 f5
  if (moveStr.startsWith('d2d4 f7f5')) return 'Dutch Defence';
  
  // English Opening: 1. c4
  if (moveStr.startsWith('c2c4')) return 'English Opening';
  // Reti / King's Indian Attack: 1. Nf3
  if (moveStr.startsWith('g1f3')) return 'Reti / KIA';

  return null;
}

function getGeneralOpening(name, moves) {
  // 1. Check moves first for accuracy
  const moveClass = classifyByMoves(moves);
  if (moveClass) return moveClass;

  // 2. Fallback to name keywords
  const n = name.toLowerCase();
  if (n.includes('caveman') || n.includes('lion')) return 'The Black Lion';
  if (n.includes('alekhine')) return 'Alekhine Defence';
  if (n.includes('scandinavian')) return 'Scandinavian Defence';
  if (n.includes('pirc') || n.includes('modern')) return 'Pirc / Modern Defence';
  if (n.includes('nimzowitsch')) return 'Nimzowitsch Defence';
  if (n.includes('london')) return 'London System';
  if (n.includes('english') || n.includes('reti')) return 'English & Reti';
  if (n.includes('staunton') || n.includes('dutch')) return 'Dutch Defence';
  if (n.includes('french')) return 'French Defence';
  if (n.includes('sicilian')) return 'Sicilian Defence';
  if (n.includes('caro-kann') || n.includes('caro')) return 'Caro-Kann Defence';
  if (n.includes('italian') || n.includes('bc4')) return 'Italian Game';
  if (n.includes('ruy') || n.includes('bb5')) return 'Ruy Lopez';
  if (n.includes('gambit')) return 'Other Gambits';
  
  return 'Other';
}

async function run() {
  const rs = await client.execute("SELECT id, name FROM book_lines");
  const counts = {};
  
  for (const row of rs.rows) {
    const lineId = Number(row.id);
    const movesRs = await client.execute({
      sql: "SELECT ply, uci FROM book_moves WHERE line_id = ? ORDER BY ply ASC LIMIT 6",
      args: [lineId]
    });
    
    const gen = getGeneralOpening(row.name, movesRs.rows);
    counts[gen] = (counts[gen] || 0) + 1;
  }

  console.log("Combined classification counts:");
  console.log(counts);
}
run().catch(console.error);
