import { randomUUID } from 'node:crypto';
import { PresignRequest, PresignResponse } from '@docflow/shared';
import { and, count, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { uploads } from '../db/schema.js';
import {
  MAX_PENDING_UPLOAD_BYTES,
  MAX_PENDING_UPLOADS,
  UPLOAD_RECORD_HOURS,
  UPLOAD_URL_SECONDS,
} from '../engine/files.js';
import { AppError } from '../errors.js';
import { currentUser, requireUser } from '../plugins/auth.js';
import type { StorageService } from '../storage/storage.js';
import { perUserLimit, type RouteDeps } from './deps.js';

export const uploadRoutes: FastifyPluginAsyncZod<RouteDeps & { storage: StorageService }> = async (
  app,
  { db, storage, limits },
) => {
  // Anyone signed in may upload; attaching the file to an order step checks who may act there
  app.addHook('onRequest', requireUser);

  // The browser uploads straight to storage with this URL; bytes never pass through the API.
  // The URL is signed for this exact type and size, so storage refuses anything else (D20).
  app.post(
    '/presign',
    {
      config: perUserLimit(limits.userActionsPerMinute),
      schema: { body: PresignRequest, response: { 200: PresignResponse } },
    },
    async (request) => {
      const user = currentUser(request);
      const { fileName, contentType, size } = request.body;
      const [pending] = await db
        .select({ n: count(), bytes: sql<number>`coalesce(sum(${uploads.fileSize}), 0)::bigint` })
        .from(uploads)
        .where(
          and(
            eq(uploads.createdBy, user.id),
            isNull(uploads.consumedAt),
            gt(uploads.expiresAt, new Date()),
          ),
        );
      if (
        (pending?.n ?? 0) >= MAX_PENDING_UPLOADS ||
        Number(pending?.bytes ?? 0) + size > MAX_PENDING_UPLOAD_BYTES
      ) {
        throw new AppError(
          429,
          'TOO_MANY_UPLOADS',
          'You have too many files uploaded but not yet sent. Send or discard them first, or try again tomorrow.',
        );
      }
      const id = randomUUID();
      const objectKey = `uploads/${user.id}/${id}`;
      await db.insert(uploads).values({
        id,
        objectKey,
        createdBy: user.id,
        fileName,
        fileMime: contentType,
        fileSize: size,
        expiresAt: new Date(Date.now() + UPLOAD_RECORD_HOURS * 3_600_000),
      });
      const put = await storage.presignPut(objectKey, {
        contentType,
        size,
        expiresInSeconds: UPLOAD_URL_SECONDS,
      });
      return {
        uploadId: id,
        url: put.url,
        headers: put.headers,
        expiresAt: put.expiresAt.toISOString(),
      };
    },
  );
};
