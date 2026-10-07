import type { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { contentDisposition, type StorageService } from './storage.js';

export interface B2Config {
  endpoint: string;
  region: string;
  keyId: string;
  applicationKey: string;
  bucket: string;
}

/**
 * Backblaze B2 through its S3-compatible API. Verified against the real bucket (Phase 3):
 * B2 enforces signed content-type and content-length on presigned PUTs, so a URL only
 * accepts the declared type and exact size.
 */
export function createB2Storage(config: B2Config): StorageService {
  const s3 = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.keyId, secretAccessKey: config.applicationKey },
    // The SDK's default CRC32 checksums add query params a browser PUT can't satisfy
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const Bucket = config.bucket;

  return {
    async presignPut(key, { contentType, size, expiresInSeconds }) {
      const url = await getSignedUrl(
        s3,
        new PutObjectCommand({ Bucket, Key: key, ContentType: contentType, ContentLength: size }),
        {
          expiresIn: expiresInSeconds,
          signableHeaders: new Set(['content-type', 'content-length']),
        },
      );
      return {
        url,
        headers: { 'content-type': contentType },
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      };
    },

    async presignGet(key, { fileName, expiresInSeconds, disposition, contentType }) {
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ResponseContentDisposition: contentDisposition(fileName, disposition),
          ...(contentType ? { ResponseContentType: contentType } : {}),
        }),
        { expiresIn: expiresInSeconds },
      );
      return { url, expiresAt: new Date(Date.now() + expiresInSeconds * 1000) };
    },

    async head(key) {
      try {
        const res = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: res.ContentLength ?? 0, contentType: res.ContentType };
      } catch (err) {
        if (err instanceof NotFound) return null;
        if (err instanceof S3ServiceException && err.$metadata.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async readRange(key, start, end) {
      const res = await s3.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=${start}-${end}` }),
      );
      return Buffer.from(await res.Body!.transformToByteArray());
    },

    async stream(key) {
      const res = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return res.Body as Readable;
    },

    async delete(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}
