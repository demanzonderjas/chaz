const { createClient } = require('@libsql/client');
const fs = require('fs');
const path = require('path');

// Manually parse .env
const envPath = path.join(__dirname, '../.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Remove surrounding quotes if present
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  }
}

const client = createClient({
  url: process.env.TURSO_DATABASE_URL || '',
  authToken: process.env.TURSO_AUTH_TOKEN || '',
});

async function main() {
  try {
    const tables = await client.execute("SELECT name FROM sqlite_master WHERE type='table';");
    console.log("Tables:");
    for (const row of tables.rows) {
      console.log(`- ${row.name}`);
      const schema = await client.execute(`PRAGMA table_info(${row.name});`);
      for (const col of schema.rows) {
        console.log(`  * ${col.name} (${col.type})`);
      }
    }
  } catch (err) {
    console.error("Error fetching schema:", err);
  } finally {
    client.close();
  }
}

main();
