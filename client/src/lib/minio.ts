import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let s3: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3) {
    const isProduction = process.env.NODE_ENV === 'production';
    const isLambda = !!process.env.AWS_LAMBDA_FUNCTION_NAME;
    
    // In Lambda, use IAM role credentials (don't set credentials explicitly)
    // In production (non-Lambda), require explicit credentials
    // In development, use MinIO credentials as fallback
    const resolvedAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const resolvedSecret = process.env.AWS_SECRET_ACCESS_KEY;

    // Only check credentials at runtime, not during build
    if (typeof window === 'undefined' && isProduction && !isLambda) {
      // Server-side runtime check (only for non-Lambda production environments)
      if (!resolvedAccessKeyId || !resolvedSecret) {
        throw new Error('AWS credentials must be configured in production environments.');
      }
    }

    // Configure S3Client
    const s3Config: {
      region?: string;
      endpoint?: string;
      forcePathStyle?: boolean;
      credentials?: {
        accessKeyId: string;
        secretAccessKey: string;
      };
    } = {
      region: process.env.AWS_REGION || 'us-east-1',
      endpoint: process.env.S3_ENDPOINT || undefined,
      forcePathStyle: !!process.env.S3_ENDPOINT,
    };

    // Only set explicit credentials if we have them AND we're not in Lambda
    // In Lambda, the SDK will automatically use IAM role credentials
    if (!isLambda) {
      s3Config.credentials = {
        accessKeyId: resolvedAccessKeyId || 'minioadmin',
        secretAccessKey: resolvedSecret || 'minioadmin',
      };
    }

    s3 = new S3Client(s3Config);
  }
  return s3;
}

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'codeclashers-avatars';

export async function generatePresignedUrl(fileName: string, contentType: string) {
  const command = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: fileName, ContentType: contentType });
  const s3Client = getS3Client();
  const url = await getSignedUrl(s3Client, command, { expiresIn: 60 * 60 * 24 });
  return url;
}

export async function deleteObject(fileName: string) {
  const s3Client = getS3Client();
  await s3Client.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: fileName }));
}
