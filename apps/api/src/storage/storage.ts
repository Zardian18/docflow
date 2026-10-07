import type { Readable } from 'node:stream';

export interface PresignedPut {
  url: string;
  /** Headers the client must send unchanged; they are part of the signature. */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
}

/**
 * File storage behind an interface (CLAUDE.md: providers are swappable by config).
 * File bytes never pass through the API to clients: browsers upload and download with
 * short-lived presigned URLs. The API only reads objects to verify them.
 */
export interface StorageService {
  presignPut(
    key: string,
    opts: { contentType: string; size: number; expiresInSeconds: number },
  ): Promise<PresignedPut>;
  presignGet(
    key: string,
    opts: { fileName: string; expiresInSeconds: number },
  ): Promise<{ url: string; expiresAt: Date }>;
  /** null when the object does not exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Bytes [start, end] inclusive. */
  readRange(key: string, start: number, end: number): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

/** Content-Disposition value that is safe for any file name (RFC 6266 / 5987). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
