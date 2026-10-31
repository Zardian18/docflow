import { createHash, randomUUID } from 'node:crypto';
import type { DocKind } from '@docflow/shared';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.js';
import { documents, uploads } from '../db/schema.js';
import { AppError, conflict } from '../errors.js';
import type { StorageService } from '../storage/storage.js';

const SIGNATURES: Record<string, Buffer[]> = {
  'application/pdf': [Buffer.from('%PDF-')],
  // DOCX and XLSX are zip containers
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  ],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  ],
  'image/jpeg': [Buffer.from([0xff, 0xd8, 0xff])],
  'image/png': [Buffer.from([0x89, 0x50, 0x4e, 0x47])],
};

function signatureMatches(mime: string, head: Buffer): boolean {
  return (SIGNATURES[mime] ?? []).some((sig) => head.subarray(0, sig.length).equals(sig));
}

async function sha256Of(storage: StorageService, key: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of await storage.stream(key)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const fileProblem = (code: string, message: string) => new AppError(400, code, message);

export interface PreparedFile {
  uploadId: string;
  uploadKey: string;
  kind: DocKind;
  fileKey: string;
  fileName: string;
  fileMime: string;
  fileSize: number;
  fileSha256: string;
}

/**
 * Checks the caller's uploads and copies each to a key under documents/ that no browser can
 * ever write to; every check runs on that copy (v1 Phase 7 finding 2). Runs before the
 * transaction. On any problem, the copies made so far are removed.
 */
export async function prepareFiles(
  db: Db,
  storage: StorageService,
  userId: string,
  orderId: string,
  wanted: Array<{ uploadId: string; kind: DocKind }>,
): Promise<{ files: PreparedFile[]; discard: () => Promise<void> }> {
  const files: PreparedFile[] = [];
  const discard = async () => {
    await Promise.all(files.map((f) => storage.delete(f.fileKey).catch(() => undefined)));
  };
  if (wanted.length === 0) return { files, discard };
  if (new Set(wanted.map((w) => w.uploadId)).size !== wanted.length) {
    throw fileProblem('UPLOAD_REPEATED', 'The same upload is attached twice.');
  }
  const rows = await db
    .select()
    .from(uploads)
    .where(
      and(
        inArray(
          uploads.id,
          wanted.map((w) => w.uploadId),
        ),
        eq(uploads.createdBy, userId),
        isNull(uploads.consumedAt),
        gt(uploads.expiresAt, new Date()),
      ),
    );
  try {
    for (const w of wanted) {
      const upload = rows.find((r) => r.id === w.uploadId);
      if (!upload) {
        throw fileProblem(
          'UPLOAD_NOT_FOUND',
          'An upload has expired or was already used. Upload the file again.',
        );
      }
      if (!(await storage.head(upload.objectKey))) {
        throw fileProblem('UPLOAD_INCOMPLETE', 'A file did not finish uploading. Upload it again.');
      }
      const fileKey = `documents/${orderId}/${randomUUID()}`;
      await storage.copy(upload.objectKey, fileKey);
      files.push({
        uploadId: upload.id,
        uploadKey: upload.objectKey,
        kind: w.kind,
        fileKey,
        fileName: upload.fileName,
        fileMime: upload.fileMime,
        fileSize: upload.fileSize,
        fileSha256: '',
      });
      const info = await storage.head(fileKey);
      if (info?.size !== upload.fileSize) {
        throw fileProblem(
          'FILE_SIZE_MISMATCH',
          `${upload.fileName} does not match what was selected. Upload it again.`,
        );
      }
      const head = await storage.readRange(fileKey, 0, 7);
      if (!signatureMatches(upload.fileMime, head)) {
        throw fileProblem(
          'FILE_TYPE_MISMATCH',
          `${upload.fileName} is not really the kind of file its name says.`,
        );
      }
      files.at(-1)!.fileSha256 = await sha256Of(storage, fileKey);
    }
  } catch (err) {
    await discard();
    throw err;
  }
  return { files, discard };
}

/** Inside the transaction: claims the uploads and records the documents. */
export async function attachFiles(
  tx: Tx,
  files: PreparedFile[],
  ctx: {
    orderId: string;
    taskId: string | null;
    roundId: string | null;
    userId: string;
    /** A private action's audience (D29) */
    audienceId?: string | null;
    /** A component's PO (D29) */
    componentId?: string | null;
  },
) {
  if (files.length === 0) return [];
  const claimed = await tx
    .update(uploads)
    .set({ consumedAt: new Date() })
    .where(
      and(
        inArray(
          uploads.id,
          files.map((f) => f.uploadId),
        ),
        isNull(uploads.consumedAt),
      ),
    )
    .returning({ id: uploads.id });
  if (claimed.length !== files.length) {
    throw conflict('UPLOAD_ALREADY_USED', 'A file was already attached. Upload it again.');
  }
  return tx
    .insert(documents)
    .values(
      files.map((f) => ({
        orderId: ctx.orderId,
        taskId: ctx.taskId,
        roundId: ctx.roundId,
        audienceId: ctx.audienceId ?? null,
        componentId: ctx.componentId ?? null,
        kind: f.kind,
        fileKey: f.fileKey,
        fileName: f.fileName,
        fileMime: f.fileMime,
        fileSize: f.fileSize,
        fileSha256: f.fileSha256,
        uploadedBy: ctx.userId,
      })),
    )
    .returning({ id: documents.id, kind: documents.kind, fileName: documents.fileName });
}

/** After commit: the browser-writable upload objects have done their job. */
export async function removeUploadObjects(storage: StorageService, files: PreparedFile[]) {
  await Promise.all(files.map((f) => storage.delete(f.uploadKey).catch(() => undefined)));
}
