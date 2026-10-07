import { randomUUID } from 'node:crypto';
import { PresignRequest, PresignResponse } from '@docflow/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { uploads } from '../db/schema.js';
import { currentUser, requirePermission } from '../plugins/auth.js';
import type { StorageService } from '../storage/storage.js';
import { perUserLimit, type RouteDeps } from './deps.js';

/** How long the browser has to start the PUT. */
const UPLOAD_URL_SECONDS = 10 * 60;
/** How long an uploaded-but-unsubmitted file stays usable. */
const UPLOAD_RECORD_HOURS = 24;

export const uploadRoutes: FastifyPluginAsyncZod<RouteDeps & { storage: StorageService }> = async (
  app,
  { db, storage, limits },
) => {
  app.addHook('onRequest', requirePermission('CREATOR'));

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
