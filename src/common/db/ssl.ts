import { fileURLToPath } from "bun";
import { readFileSync } from "node:fs";
import { appLogger } from "../logger";

/**
 * Resolves SSL config for Postgres in non-local environments.
 * - If DATABASE_SSL_CA_PATH is set and the file exists, uses that CA.
 * - Otherwise tries default path ../../certs/coolify-db.pem relative to this file.
 * - If no CA file is found, uses ssl: { rejectUnauthorized: false } so connections
 *   still work (e.g. in containers where the cert is not mounted).
 */
export function getSslConfig(env: { APP_ENV: string, DB_SSL_CERT: string }): false | { ca: string, rejectUnauthorized: true } | { rejectUnauthorized: false } {
	if (env.APP_ENV === 'local') {
    const certPath = fileURLToPath(new URL('../../certs/coolify-db.pem', import.meta.url));
    const cert = readFileSync(certPath).toString();

    appLogger.info({ certPath }, '[SSL] Certificate found at path');

    appLogger.info({ cert }, '[SSL] Certificate content');

    if(!cert) {
      appLogger.error({ error: new Error('No certificate found at path') }, '[SSL] No certificate found at path');

      return {
        rejectUnauthorized: false
      };
    }

    return {
			ca: cert,
      rejectUnauthorized: true
		};
	}

  appLogger.info({ env }, '[SSL] env');

	if (env.DB_SSL_CERT) {
    appLogger.info({ DB_SSL_CERT: env.DB_SSL_CERT }, '[SSL] DB_SSL_CERT found');

		return {
			ca: env.DB_SSL_CERT,
      rejectUnauthorized: true
		};
	}

	// No CA file (e.g. cert not mounted in container): still use SSL, skip cert verification
	return { rejectUnauthorized: false };
}
