import { appLogger } from '@common/logger';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { env } from '@common/config/env';

const DATABASE_URL = env.DATABASE_URL;

const ssl =
	env.APP_ENV === 'local'
		? false
		: {
				ca: readFileSync(new URL('../../certs/coolify-db.pem', import.meta.url)).toString(),
				rejectUnauthorized: false,
		  };

/**
 * Run all pending database migrations from the ./drizzle folder.
 *
 * This helper is shared between the CLI migration script and E2E tests.
 */
export async function runMigrations() {
	appLogger.info('[MIGRATION] Starting database migration...');

	const migrationClient = postgres(DATABASE_URL, { max: 1, ssl });

	// Ensure tables are created in public schema (avoids \"no schema has been selected to create in\")
	await migrationClient.unsafe('SET search_path TO public');

	const db = drizzle(migrationClient);

	try {
		await migrate(db, { migrationsFolder: './drizzle' });
		appLogger.info('[MIGRATION] Migrations completed successfully');
	} catch (error) {
		appLogger.error({ error }, '[MIGRATION] Migration failed');
		throw error;
	} finally {
		await migrationClient.end();
	}
}

