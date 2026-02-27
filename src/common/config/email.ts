import { appLogger } from '@common/logger';
import { recordExternalCall } from '@common/otel/metrics';
import { record } from '@elysiajs/opentelemetry';
import { Resend } from 'resend';
import { env } from './env';

/**
 * Email sending helper using Resend
 * Falls back to console logging if RESEND_API_KEY is not set
 */
export const sendEmail = async ({
	to,
	subject,
	text,
	html,
}: {
	to: string;
	subject: string;
	text: string;
	html?: string;
}) => {
	if (env.RESEND_API_KEY && env.RESEND_API_KEY.length > 0) {
		const start = Date.now();
		try {
			const result = await record('resend.emails.send', async () => {
				const resend = new Resend(env.RESEND_API_KEY);
				return resend.emails.send({
					from: env.EMAIL_FROM,
					to,
					subject,
					text,
					html,
				});
			});
			const success = !result.error;
			if (!success) {
				appLogger.error({ to, subject, error: result.error }, 'Failed to send email via Resend');
			} else {
				appLogger.info({ to, subject, id: result.data?.id }, 'Email sent via Resend');
			}
			recordExternalCall('resend', Date.now() - start, success);
		} catch (error) {
			recordExternalCall('resend', Date.now() - start, false);
			appLogger.error({ to, subject, error }, 'Error sending email via Resend');
		}
	} else {
		appLogger.info({ to, subject, text }, 'Email (not sent - no RESEND_API_KEY)');
	}
};
