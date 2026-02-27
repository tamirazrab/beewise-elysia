import { appLogger } from '@common/logger';
import { runMigrations } from '@common/db/migrate';

runMigrations()
	.then(() => {
		appLogger.info('[MIGRATION] Migration script finished');
		process.exit(0);
	})
	.catch((error) => {
		appLogger.error({ error }, '[MIGRATION] Critical error');
		process.exit(1);
	});
