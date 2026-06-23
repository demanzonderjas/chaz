const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || '';
const authToken = process.env.TURSO_AUTH_TOKEN || '';

const turso = createClient({
  url,
  authToken,
});

async function main() {
  try {
    const rs = await turso.execute(`
      SELECT o.id, o.name, g.user_color, COUNT(*) as game_count
      FROM games g
      JOIN openings o ON g.opening_id = o.id
      GROUP BY o.id, o.name, g.user_color
      ORDER BY game_count DESC
    `);
    console.log("Openings from games:", rs.rows);
  } catch (err) {
    console.error(err);
  }
}

main();
