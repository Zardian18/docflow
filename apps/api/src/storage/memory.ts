import { Readable } from 'node:stream';
import type { StorageService } from './storage.js';

/** In-memory storage for tests: lets them "upload" bytes and inspect what was deleted. */
export class MemoryStorage implements StorageService {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();
  readonly deleted: string[] = [];

  /** Simulates the browser's PUT to the presigned URL. */
  upload(key: string, body: Buffer, contentType: string) {
    this.objects.set(key, { body, contentType });
  }

  async presignPut(
    key: string,
    opts: { contentType: string; size: number; expiresInSeconds: number },
  ) {
    return {
      url: `https://storage.test/put/${encodeURIComponent(key)}`,
      headers: { 'content-type': opts.contentType },
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000),
    };
  }

  async presignGet(key: string, opts: { fileName: string; expiresInSeconds: number }) {
    return {
      url: `https://storage.test/get/${encodeURIComponent(key)}?name=${encodeURIComponent(opts.fileName)}`,
      expiresAt: new Date(Date.now() + opts.expiresInSeconds * 1000),
    };
  }

  async head(key: string) {
    const obj = this.objects.get(key);
    return obj ? { size: obj.body.length, contentType: obj.contentType } : null;
  }

  async readRange(key: string, start: number, end: number) {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`no object ${key}`);
    return obj.body.subarray(start, end + 1);
  }

  async stream(key: string) {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`no object ${key}`);
    return Readable.from([obj.body]);
  }

  async delete(key: string) {
    this.objects.delete(key);
    this.deleted.push(key);
  }
}
