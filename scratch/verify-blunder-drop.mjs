import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';
import { Chess } from 'chess.js';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)[1];
const token = env.match(/TURSO_AUTH_TOKEN=(.+)/)[1];
const client = createClient({ url, authToken: token });

const startFen = 'rr1b2k1/5p2/4p1p1/p2pPq2/3P1P1p/2P2Q2/R3NKPP/R7 w - - 9 33';
const chess = new Chess(startFen);
chess.move({ from: 'h2', to: 'h3' });
const nextFen = chess.fen();
const normBefore = startFen.split(' ').slice(0, 4).join(' ');
const normAfter = nextFen.split(' ').slice(0, 4).join(' ');

async function run() {
  const r = await client.execute({
    sql: 'SELECT fen_norm, result_json FROM analysis WHERE fen_norm IN (?, ?)',
    args: [normBefore, normAfter]
  });
  const map = {};
  r.rows.forEach(x => {
    map[x.fen_norm] = JSON.parse(x.result_json);
  });
  const eb = map[normBefore];
  const ea = map[normAfter];
  
  if (!eb || !ea) {
    console.log("Missing evals!");
    return;
  }

  const scoreBefore = eb.cp;
  const scoreAfter = -ea.cp;
  const getWinProbability = (cp) => 1 / (1 + Math.pow(10, -cp / 400));
  const wpBefore = getWinProbability(scoreBefore);
  const wpAfter = getWinProbability(scoreAfter);
  console.log('Before score:', scoreBefore, 'WP:', wpBefore);
  console.log('After score:', scoreAfter, 'WP:', wpAfter);
  console.log('Drop:', wpBefore - wpAfter);
}

run().catch(console.error);
