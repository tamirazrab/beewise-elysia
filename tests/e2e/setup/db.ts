import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { env } from '@common/config/env';
import { runMigrations as baseRunMigrations } from '@common/db/migrate';

const ssl =
	env.APP_ENV === 'local'
		? false
		: {
				ca: readFileSync(new URL('../../../certs/coolify-db.pem', import.meta.url)).toString(),
				rejectUnauthorized: false,
		  };

/**
 * Truncate all application tables in the public schema and
 * reset identity sequences. Safe to call between tests.
 */
export async function resetDatabase() {
	const client = postgres(env.DATABASE_URL, { max: 1, ssl });

	try {
		await client.unsafe(`
      DO $$ DECLARE
        r RECORD;
      BEGIN
        FOR r IN (
          SELECT tablename
          FROM pg_tables
          WHERE schemaname = 'public'
        ) LOOP
          EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
        END LOOP;
      END $$;
    `);
	} finally {
		await client.end();
	}
}

/**
 * Re-export runMigrations for use in tests.
 */
export const runMigrations = baseRunMigrations;

