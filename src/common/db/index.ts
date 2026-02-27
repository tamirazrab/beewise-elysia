import { env } from '@common/config/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import * as schema from './schema';

/**
 * Database connection and ORM setup
 */

const ssl =
	env.APP_ENV === 'local'
		? false
		: {
				ca: readFileSync(new URL('../../certs/coolify-db.pem', import.meta.url)).toString(),
		  };

const client = postgres(env.DATABASE_URL, {
	max: 10,
	idle_timeout: 20,
	connect_timeout: 10,
	ssl,
});

export const db = drizzle(client, { schema });

export async function closeDatabase() {
	await client.end();
}
