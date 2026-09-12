import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const localRoot = fileURLToPath(new URL('../../../.local-data/', import.meta.url));

export async function openDatabase({ url = process.env.DATABASE_URL, directory = `${localRoot}/postgres` } = {}) {
  let db;
  if (url) {
    const pool = new pg.Pool({ connectionString: url, max: 5, connectionTimeoutMillis: 5000 });
    pool.on('error', () => console.error('Database connection interrupted.'));
    db = {
      query: (sql, values) => pool.query(sql, values),
      async transaction(fn) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const result = await fn(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        } finally { client.release(); }
      },
      close: () => pool.end(),
      driver: 'postgres',
    };
  } else {
    if (directory) await mkdir(directory, { recursive: true });
    const engine = await PGlite.create(directory || undefined);
    db = {
      query: (sql, values) => engine.query(sql, values),
      transaction: fn => engine.transaction(fn),
      close: () => engine.close(),
      driver: 'pglite-local',
    };
  }
  const migration = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  const deploymentMigration = await readFile(new URL('./deployment-schema.sql', import.meta.url), 'utf8');
  await db.transaction(async tx => {
    if (db.driver === 'postgres') await tx.query('SELECT pg_advisory_xact_lock(81402026)');
    // Both drivers accept each DDL statement individually inside one transaction.
    for (const sql of `${migration}\n${deploymentMigration}`.split(';').map(s => s.trim()).filter(Boolean)) await tx.query(sql);
  });
  return db;
}
