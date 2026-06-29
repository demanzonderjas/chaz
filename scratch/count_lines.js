const { createClient } = require('@libsql/client');

const url = process.env.TURSO_DATABASE_URL || '';
const authToken = process.env.TURSO_AUTH_TOKEN || '';

const turso = createClient({
  url,
  authToken,
});

async function main() {
  try {
    const linesRs = await turso.execute('SELECT color, COUNT(*) as count FROM book_lines GROUP BY color');
    console.log("Book lines by color:", linesRs.rows);

    const movesRs = await turso.execute(`
      SELECT bl.color, COUNT(*) as count 
      FROM book_moves bm 
      JOIN book_lines bl ON bm.line_id = bl.id 
      GROUP BY bl.color
    `);
    console.log("Book moves by line color:", movesRs.rows);
  } catch (err) {
    console.error(err);
  }
}

main();
