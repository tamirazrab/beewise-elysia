/**
 * Client IP resolution for rate limiting and abuse checks.
 * Use only when behind a trusted proxy that sets X-Forwarded-For or X-Real-IP.
 * Do not trust client-sent headers if the app is directly exposed.
 */

export function getClientIP(request: Request): string {
	return (
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
		request.headers.get('x-real-ip') ||
		'127.0.0.1'
	);
}
