import { env } from '@common/config/env';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { getSslConfig } from './ssl';

/**
 * Database connection and ORM setup
 */

const ssl = getSslConfig({ APP_ENV: env.APP_ENV, DB_SSL_CERT: env.DB_SSL_CERT ?? '' });

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
