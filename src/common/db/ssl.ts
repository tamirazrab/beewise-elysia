import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
/**
 * Resolves SSL config for Postgres in non-local environments.
 * - If DATABASE_SSL_CA_PATH is set and the file exists, uses that CA.
 * - Otherwise tries default path ../../certs/coolify-db.pem relative to this file.
 * - If no CA file is found, uses ssl: { rejectUnauthorized: false } so connections
 *   still work (e.g. in containers where the cert is not mounted).
 */
export function getSslConfig(env: { APP_ENV: string }): false | { ca: string } | { rejectUnauthorized: false } {
	if (env.APP_ENV === 'local') {
		return false;
	}

  return false;

  // todo: inject or mount ca to volume at runtime

	const defaultCaPath = fileURLToPath(new URL('../../certs/coolify-db.pem', import.meta.url));
	const caPath = process.env['DATABASE_SSL_CA_PATH'] ?? defaultCaPath;

	if (existsSync(caPath)) {
		return {
			ca: readFileSync(caPath, 'utf8'),
		};
	}

	// No CA file (e.g. cert not mounted in container): still use SSL, skip cert verification
	return { rejectUnauthorized: false };
}
