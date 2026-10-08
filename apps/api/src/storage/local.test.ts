import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createLocalStorage } from './local.js';

const PDF = 'application/pdf';

describe('local storage driver (development/CI only)', () => {
  let dir: string;
  const app = Fastify();
  let local: ReturnType<typeof createLocalStorage>;

  beforeAll(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'docflow-local-'));
    local = createLocalStorage({ dir, publicUrl: 'http://api.test', secret: 's'.repeat(32) });
    await app.register(local.routes);
  });
  afterAll(async () => {
    await app.close();
    await fs.rm(dir, { recursive: true, force: true });
  });

  const key = () => `uploads/${randomUUID()}/${randomUUID()}`;
  const pathOf = (url: string) => {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  };

  it('accepts a PUT only with the signed type and exact size, like B2', async () => {
    const k = key();
    const put = await local.storage.presignPut(k, {
      contentType: PDF,
      size: 8,
      expiresInSeconds: 60,
    });
    const send = (body: Buffer, type = PDF) =>
      app.inject({
        method: 'PUT',
        url: pathOf(put.url),
        headers: { 'content-type': type },
        payload: body,
      });
    expect((await send(Buffer.from('%PDF-1.7x'))).statusCode).toBe(403);
    expect((await send(Buffer.from('%PDF-1.7'), 'text/html')).statusCode).toBe(403);
    expect((await send(Buffer.from('%PDF-1.7'))).statusCode).toBe(200);
    expect(await local.storage.head(k)).toEqual({ size: 8, contentType: PDF });
    expect((await local.storage.readRange(k, 0, 4)).toString()).toBe('%PDF-');
  });

  it('refuses a tampered or expired URL', async () => {
    const put = await local.storage.presignPut(key(), {
      contentType: PDF,
      size: 1,
      expiresInSeconds: 60,
    });
    const [body, mac] = new URL(put.url).searchParams.get('t')!.split('.');
    const forged = JSON.parse(Buffer.from(body!, 'base64url').toString());
    forged.size = 2;
    const tampered = `/local-storage?t=${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${mac}`;
    const res = await app.inject({
      method: 'PUT',
      url: tampered,
      headers: { 'content-type': PDF },
      payload: Buffer.from('ab'),
    });
    expect(res.statusCode).toBe(403);

    const expired = await local.storage.presignPut(key(), {
      contentType: PDF,
      size: 1,
      expiresInSeconds: -1,
    });
    const late = await app.inject({
      method: 'PUT',
      url: pathOf(expired.url),
      headers: { 'content-type': PDF },
      payload: Buffer.from('a'),
    });
    expect(late.statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/local-storage?t=garbage' })).statusCode).toBe(
      403,
    );
  });

  it('serves a GET with the chosen disposition, and copies and deletes', async () => {
    const k = key();
    const put = await local.storage.presignPut(k, {
      contentType: PDF,
      size: 3,
      expiresInSeconds: 60,
    });
    await app.inject({
      method: 'PUT',
      url: pathOf(put.url),
      headers: { 'content-type': PDF },
      payload: Buffer.from('abc'),
    });
    const doc = `documents/${randomUUID()}`;
    await local.storage.copy(k, doc);
    const get = await local.storage.presignGet(doc, {
      fileName: 'Q3 Invoice.pdf',
      expiresInSeconds: 60,
      disposition: 'inline',
      contentType: PDF,
    });
    const res = await app.inject({ method: 'GET', url: pathOf(get.url) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('abc');
    expect(res.headers['content-type']).toBe(PDF);
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="Q3 Invoice.pdf"/);
    await local.storage.delete(doc);
    expect(await local.storage.head(doc)).toBeNull();
  });

  it('refuses keys it did not generate', async () => {
    await expect(local.storage.head('../../etc/passwd')).resolves.toBeNull();
    await expect(local.storage.delete('../x')).rejects.toThrow(/refusing/);
  });
});
