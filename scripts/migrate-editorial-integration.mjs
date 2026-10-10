import { Client } from 'pg';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const local = process.argv.includes('--local');
if (!local) {
  const env = await import('@next/env');
  (env.loadEnvConfig ?? env.default.loadEnvConfig)(process.cwd());
}
const client = new Client({
  connectionString: local
    ? 'postgresql://postgres@127.0.0.1:55432/editorial_test'
    : (process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL),
});
await client.connect();
try {
  await client.query('begin');
  await client.query(
    "select pg_advisory_xact_lock(hashtext('editorial-integration-migration'))",
  );
  const exists = await client.query(
    "select to_regclass('public.editorial_integration_packages') as name",
  );
  const ddl = await readFile('drizzle/0016_editorial_integration.sql', 'utf8');
  if (!exists.rows[0].name)
    for (const statement of ddl
      .split('--> statement-breakpoint')
      .filter((value) => value.trim()))
      await client.query(statement);
  // Keep Drizzle's existing migration journal synchronized; older local test
  // databases created from SQL files do not have a Drizzle journal.
  const journal = await client.query(
    "select to_regclass('drizzle.__drizzle_migrations') as name",
  );
  if (journal.rows[0].name) {
    const stamp = 1790946000000;
    const found = await client.query(
      'select 1 from drizzle.__drizzle_migrations where created_at=$1',
      [stamp],
    );
    if (!found.rowCount)
      await client.query(
        'insert into drizzle.__drizzle_migrations(hash,created_at) values($1,$2)',
        [createHash('sha256').update(ddl).digest('hex'), stamp],
      );
  }
  await client.query('commit');
  console.log(
    'Integration migration ready (' +
      (local ? 'isolated local database' : 'configured deployment database') +
      ').',
  );
} catch (error) {
  await client.query('rollback');
  console.error('Migration failed:', error.code ?? error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
