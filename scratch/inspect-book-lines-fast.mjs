import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

function classifyByMoves(moves) {
  const moveStr = moves.map(m => m.uci).join(' ');
  
  if (moveStr.startsWith('e2e4 c7c5')) return 'Sicilian Defence';
  if (moveStr.startsWith('e2e4 e7e6')) return 'French Defence';
  if (moveStr.startsWith('e2e4 c7c6')) return 'Caro-Kann Defence';
  if (moveStr.startsWith('e2e4 d7d5')) return 'Scandinavian Defence';
  if (moveStr.startsWith('e2e4 b8c6')) return 'Nimzowitsch Defence';
  if (moveStr.startsWith('e2e4 d7d6') || moveStr.startsWith('e2e4 g7g6')) {
    return 'Pirc / Modern Defence';
  }
  if (moveStr.startsWith('e2e4 g8f6')) return 'Alekhine Defence';
  if (moveStr.startsWith('e2e4 e7e5 g1f3 b8c6 f1b5')) return 'Ruy Lopez';
  if (moveStr.startsWith('e2e4 e7e5 g1f3 b8c6 f1c4')) return 'Italian Game';
  
  if (moveStr.startsWith('d2d4') && moves.some(m => m.uci === 'c1f4' || m.uci === 'c1f4')) return 'London System';
  if (moveStr.startsWith('d2d4 d7d5 c2c4')) return 'Queen\'s Gambit';
  if (moveStr.startsWith('d2d4 g8f6 c2c4 g7g6')) return 'King\'s Indian / Grunfeld';
  if (moveStr.startsWith('d2d4 g8f6 c2c4 e7e6')) return 'Indian Defences';
  if (moveStr.startsWith('d2d4 f7f5')) return 'Dutch Defence';
  
  if (moveStr.startsWith('c2c4')) return 'English Opening';
  if (moveStr.startsWith('g1f3')) return 'Reti / KIA';

  return null;
}

function getGeneralOpening(name, moves) {
  const moveClass = classifyByMoves(moves);
  if (moveClass) return moveClass;

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
  
  return 'Other / General';
}

async function run() {
  console.time('fetch');
  const sql = `
    SELECT bl.id as line_id, bl.name, bl.color, bm.ply, bm.uci
    FROM book_lines bl
    LEFT JOIN book_moves bm ON bl.id = bm.line_id AND bm.ply <= 6
    ORDER BY bl.id, bm.ply ASC
  `;
  const rs = await client.execute(sql);
  console.timeEnd('fetch');

  // Group by line_id
  const linesMap = new Map();
  for (const row of rs.rows) {
    const lineId = Number(row.line_id);
    if (!linesMap.has(lineId)) {
      linesMap.set(lineId, {
        name: String(row.name),
        color: String(row.color || ''),
        moves: []
      });
    }
    if (row.ply !== null && row.uci !== null) {
      linesMap.get(lineId).moves.push({
        ply: Number(row.ply),
        uci: String(row.uci)
      });
    }
  }

  const counts = {};
  const colors = {};

  for (const [lineId, line] of linesMap.entries()) {
    const gen = getGeneralOpening(line.name, line.moves);
    counts[gen] = (counts[gen] || 0) + 1;
    colors[line.color] = (colors[line.color] || 0) + 1;
  }

  console.log("Unique colors in book_lines:", colors);
  console.log("Classification counts:");
  console.log(counts);
}
run().catch(console.error);
