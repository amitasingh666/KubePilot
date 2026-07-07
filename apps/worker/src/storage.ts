// S3-compatible object storage (MinIO in dev). The ONLY place Phase 5 touches
// object storage — for the scheduled digest artifact, which is generated with no
// browser present (so it can't be built client-side).
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const BUCKET = process.env.S3_BUCKET ?? "kubepilot-reports";

const client = new S3Client({
  endpoint: process.env.S3_ENDPOINT ?? "http://localhost:9000",
  region: process.env.S3_REGION ?? "us-east-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY ?? "minioadmin",
    secretAccessKey: process.env.S3_SECRET_KEY ?? "minioadmin",
  },
  forcePathStyle: true, // required for MinIO (no virtual-hosted-style buckets)
});

export async function putObject(key: string, body: string, contentType = "text/html"): Promise<void> {
  await client.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: body, ContentType: contentType }));
}

/** A time-limited download link for a stored object (default 7 days). */
export function presignedGetUrl(key: string, expiresSec = 7 * 24 * 3600): Promise<string> {
  return getSignedUrl(client, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: expiresSec });
}
