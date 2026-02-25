import { createHash } from 'node:crypto';

/** Header name for anonymous free-tier device identification */
export const DEVICE_ID_HEADER = 'x-device-id';

const MAX_DEVICE_ID_LENGTH = 512;

/**
 * Normalize and hash a device ID for anonymous identity.
 * Server stores only the hash (e.g. for linking on signup).
 */
export function hashDeviceId(deviceId: string): string {
	const trimmed = deviceId.trim();
	if (!trimmed) return '';
	const normalized = trimmed.length > MAX_DEVICE_ID_LENGTH ? trimmed.slice(0, MAX_DEVICE_ID_LENGTH) : trimmed;
	return createHash('sha256').update(normalized).digest('hex');
}

/**
 * Extract device ID from request header (for use in derive before body is parsed).
 */
export function getDeviceIdFromRequest(request: Request): string | null {
	const value = request.headers.get(DEVICE_ID_HEADER)?.trim();
	if (!value || value.length > MAX_DEVICE_ID_LENGTH) return null;
	return value;
}
