const { createClient } = require('@libsql/client');

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

async function clear() {
  await client.execute('DELETE FROM brilliant_moves');
  console.log('Cleared brilliant_moves table.');
}

clear();
