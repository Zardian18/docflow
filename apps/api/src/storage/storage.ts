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
  /**
   * `inline` asks the browser to display the file in the tab (PDFs); `attachment` to save it.
   * `contentType` is sent back with the file so an inline PDF is recognised as one.
   */
  presignGet(
    key: string,
    opts: {
      fileName: string;
      expiresInSeconds: number;
      disposition?: 'inline' | 'attachment';
      contentType?: string;
    },
  ): Promise<{ url: string; expiresAt: Date }>;
  /** null when the object does not exist. */
  head(key: string): Promise<ObjectInfo | null>;
  /** Bytes [start, end] inclusive. */
  readRange(key: string, start: number, end: number): Promise<Buffer>;
  stream(key: string): Promise<Readable>;
  /** Server-side copy within the bucket; the bytes never pass through the API. */
  copy(fromKey: string, toKey: string): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Content-Disposition value that is safe for any file name (RFC 6266 / 5987). */
export function contentDisposition(
  fileName: string,
  disposition: 'inline' | 'attachment' = 'attachment',
): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
