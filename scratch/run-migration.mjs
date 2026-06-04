import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  console.log("Running migration...");
  try {
    await client.execute("ALTER TABLE puzzles ADD COLUMN type TEXT DEFAULT 'tactical'");
    console.log("Successfully added column 'type' to puzzles table.");
  } catch (err) {
    if (err.message.includes("duplicate column name") || err.message.includes("already exists") || err.message.includes("duplicate")) {
      console.log("Column 'type' already exists in puzzles table. Skipping.");
    } else {
      throw err;
    }
  }
}
run().catch(console.error);
