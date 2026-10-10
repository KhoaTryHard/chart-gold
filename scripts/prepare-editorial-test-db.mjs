import { Client } from 'pg';
import { readFile } from 'node:fs/promises';

// Explicitly local, disposable database. Never uses DATABASE_URL or .env files.
const base = 'postgresql://postgres@127.0.0.1:55432/';
const admin = new Client({ connectionString: base + 'postgres' });
await admin.connect();
if (
  !(
    await admin.query(
      "select 1 from pg_database where datname='editorial_test'",
    )
  ).rowCount
)
  await admin.query('create database editorial_test');
await admin.end();
const client = new Client({ connectionString: base + 'editorial_test' });
await client.connect();
try {
  const exists = await client.query(
    "select to_regclass('public.articles') as table_name",
  );
  if (!exists.rows[0].table_name) {
    const journal = JSON.parse(
      await readFile('drizzle/meta/_journal.json', 'utf8'),
    );
    for (const migration of journal.entries) {
      const body = await readFile(`drizzle/${migration.tag}.sql`, 'utf8');
      for (const statement of body
        .split('--> statement-breakpoint')
        .filter((value) => value.trim()))
        await client.query(statement);
    }
  }
  console.log(
    'Local editorial_test database ready; no production credentials used.',
  );
} finally {
  await client.end();
}
