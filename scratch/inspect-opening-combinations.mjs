import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  const sql = `
    SELECT g.opening_id, o.name as opening_name, g.user_color, COUNT(*) as game_count
    FROM games g
    JOIN openings o ON g.opening_id = o.id
    GROUP BY g.opening_id, o.name, g.user_color
    ORDER BY game_count DESC
  `;
  const rs = await client.execute(sql);
  console.log("Unique Opening + Color combinations in games:");
  console.log(rs.rows.map(r => ({
    id: r.opening_id,
    name: r.opening_name,
    color: r.user_color,
    count: r.game_count
  })));
}
run().catch(console.error);
