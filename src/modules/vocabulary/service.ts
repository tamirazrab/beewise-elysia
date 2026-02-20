import { env } from '@common/config/env';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/**
 * Vocabulary Service
 * Handles S3 integration for practice recordings
 */

const s3Client = new S3Client({
	region: env.AWS_REGION,
	...(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
		? {
				credentials: {
					accessKeyId: env.AWS_ACCESS_KEY_ID,
					secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
				},
			}
		: {}),
});

const SIGNED_URL_EXPIRES_IN = 3600;

export function generateS3Key(userId: string, sessionId: string, recordingId: string): string {
	return `practice/${userId}/${sessionId}/${recordingId}.wav`;
}

export async function generateUploadSignedUrl(s3Key: string): Promise<string> {
	const command = new PutObjectCommand({
		Bucket: env.S3_BUCKET_NAME,
		Key: s3Key,
		ContentType: 'audio/wav',
	});

	return await getSignedUrl(s3Client, command, { expiresIn: SIGNED_URL_EXPIRES_IN });
}

export async function generateDownloadSignedUrl(s3Key: string): Promise<string> {
	const command = new GetObjectCommand({
		Bucket: env.S3_BUCKET_NAME,
		Key: s3Key,
	});

	return await getSignedUrl(s3Client, command, { expiresIn: SIGNED_URL_EXPIRES_IN });
}
