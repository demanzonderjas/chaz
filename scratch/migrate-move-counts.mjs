import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  console.log("Starting migration to halve existing games move counts...");
  
  // Show counts before migration
  const before = await client.execute("SELECT id, white_name, black_name, move_count FROM games LIMIT 5");
  console.log("Before migration:");
  before.rows.forEach(r => console.log(`  ID: ${r.id} | ${r.white_name} vs ${r.black_name} | Move Count: ${r.move_count}`));

  // Perform migration
  const result = await client.execute("UPDATE games SET move_count = (move_count + 1) / 2");
  console.log(`Successfully migrated ${result.rowsAffected} rows.`);

  // Show counts after migration
  const after = await client.execute("SELECT id, white_name, black_name, move_count FROM games LIMIT 5");
  console.log("After migration:");
  after.rows.forEach(r => console.log(`  ID: ${r.id} | ${r.white_name} vs ${r.black_name} | Move Count: ${r.move_count}`));
}

run().catch(console.error);
