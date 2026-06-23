import { readFileSync } from 'fs';
import { createClient } from '@libsql/client';

const env = readFileSync('.env', 'utf-8');
const url = env.match(/TURSO_DATABASE_URL=(.+)/)?.[1];
const authToken = env.match(/TURSO_AUTH_TOKEN=(.+)/)?.[1];

const client = createClient({ url, authToken });

async function run() {
  try {
    const tx = await client.transaction("write");
    console.log("Transaction created successfully!");
    await tx.rollback();
    console.log("Transaction rolled back successfully!");
  } catch (e) {
    console.error("Transaction failed:", e.message);
  } finally {
    client.close();
  }
}

run();
