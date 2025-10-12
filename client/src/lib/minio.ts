import { S3Client, DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  endpoint: process.env.S3_ENDPOINT || undefined,
  forcePathStyle: !!process.env.S3_ENDPOINT,
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'minioadmin',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'minioadmin',
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'codeclashers-avatars';

export async function generatePresignedUrl(fileName: string, contentType: string) {
  const command = new PutObjectCommand({ Bucket: BUCKET_NAME, Key: fileName, ContentType: contentType });
  const url = await getSignedUrl(s3, command, { expiresIn: 60 * 60 * 24 });
  return url;
}

export async function deleteObject(fileName: string) {
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: fileName }));
}
