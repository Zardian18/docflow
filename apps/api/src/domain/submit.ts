import { createHash, randomUUID } from 'node:crypto';
import type { WorkflowCreate } from '@docflow/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { z } from 'zod';
import type { Db } from '../db/client.js';
import { auditEvents, companies, uploads, workflowSteps, workflows } from '../db/schema.js';
import { AppError, conflict, isUniqueViolation } from '../errors.js';
import type { StorageService } from '../storage/storage.js';
import { enqueue } from '../notify/outbox.js';
import { activeCfo, chainsDiffer, checkChain, defaultApproversFor } from './chain.js';
import { yourTurnMessages } from './decide.js';

type SubmitInput = z.output<typeof WorkflowCreate>;

const PDF_MAGIC = Buffer.from('%PDF-');
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // DOCX is a zip container

function signatureMatches(mime: string, head: Buffer): boolean {
  if (mime === 'application/pdf') return head.subarray(0, PDF_MAGIC.length).equals(PDF_MAGIC);
  return head.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC);
}

async function sha256Of(storage: StorageService, key: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of await storage.stream(key)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

const fileProblem = (code: string, message: string) => new AppError(400, code, message);

/**
 * Creates a workflow from an uploaded file (plan.md §4.7). Verifies the stored object
 * really is what was declared, validates the chain, then writes the workflow, the chain
 * snapshot (invariant 2) and the SUBMITTED audit event in one transaction.
 */
export async function submitWorkflow(
  db: Db,
  storage: StorageService,
  creatorId: string,
  input: SubmitInput,
): Promise<{ id: string; outboxIds: string[] }> {
  // ---- The upload: the caller's own, unused, unexpired
  const [upload] = await db
    .select()
    .from(uploads)
    .where(
      and(
        eq(uploads.id, input.uploadId),
        eq(uploads.createdBy, creatorId),
        isNull(uploads.consumedAt),
        gt(uploads.expiresAt, new Date()),
      ),
    );
  if (!upload) {
    throw fileProblem(
      'UPLOAD_NOT_FOUND',
      'This upload has expired or was already submitted. Upload the file again.',
    );
  }

  // ---- The stored object must have arrived before anything else is checked
  if (!(await storage.head(upload.objectKey))) {
    throw fileProblem('UPLOAD_INCOMPLETE', 'The file did not finish uploading. Upload it again.');
  }

  // ---- Company, CFO and chain (plan.md §4.7)
  const [company] = await db
    .select({ id: companies.id, name: companies.name, isActive: companies.isActive })
    .from(companies)
    .where(eq(companies.id, input.companyId));
  if (!company?.isActive) {
    throw new AppError(400, 'COMPANY_UNAVAILABLE', 'Choose an active company.');
  }
  const cfo = await activeCfo(db);
  if (!cfo) {
    throw new AppError(
      409,
      'NO_ACTIVE_CFO',
      'There is no active CFO yet, so documents can’t be submitted. Contact your administrator.',
    );
  }
  const chain = await checkChain(db, input.approvers);
  // Structurally impossible (Creators never have the APPROVER permission), but asserted anyway
  if (chain.some((a) => a.employeeId === creatorId || a.employeeId === cfo.id)) {
    throw new AppError(
      400,
      'INELIGIBLE_APPROVER',
      'The chain can’t include you or the CFO as an approver.',
    );
  }
  const defaults = (await defaultApproversFor(db, [company.id])).get(company.id) ?? [];
  const chainCustomised = chainsDiffer(chain, defaults);
  const cfoPosition = Math.max(...chain.map((a) => a.position)) + 1;
  // ---- The stored object. The Creator's upload URL stays usable for a few minutes, so the
  // file is copied to a key no one else can write to and every check runs on that copy:
  // what was verified is exactly what the approvers will open (Phase 7 finding 2).
  const workflowId = randomUUID();
  const fileKey = `documents/${workflowId}`;
  await storage.copy(upload.objectKey, fileKey);
  const dropCopy = () => storage.delete(fileKey).catch(() => undefined);
  const discard = async (problem: AppError) => {
    await Promise.all([dropCopy(), storage.delete(upload.objectKey).catch(() => undefined)]);
    return problem;
  };
  const info = await storage.head(fileKey);
  if (info?.size !== upload.fileSize) {
    throw await discard(
      fileProblem(
        'FILE_SIZE_MISMATCH',
        'The uploaded file does not match what was selected. Upload it again.',
      ),
    );
  }
  const head = await storage.readRange(fileKey, 0, 7);
  if (!signatureMatches(upload.fileMime, head)) {
    throw await discard(
      fileProblem(
        'FILE_TYPE_MISMATCH',
        'This file is not a valid PDF or DOCX document, even though its name says so.',
      ),
    );
  }
  let fileSha256: string;
  try {
    fileSha256 = await sha256Of(storage, fileKey);
  } catch (err) {
    await dropCopy();
    throw err;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Claim the upload first: a concurrent second submit finds nothing to claim
      const claimed = await tx
        .update(uploads)
        .set({ consumedAt: new Date() })
        .where(and(eq(uploads.id, upload.id), isNull(uploads.consumedAt)))
        .returning({ id: uploads.id });
      if (claimed.length === 0)
        throw conflict('ALREADY_SUBMITTED', 'This document was already submitted.');

      await tx.insert(workflows).values({
        id: workflowId,
        uploadId: upload.id,
        title: upload.fileName,
        fileKey,
        fileName: upload.fileName,
        fileMime: upload.fileMime,
        fileSize: upload.fileSize,
        fileSha256,
        companyId: company.id,
        createdBy: creatorId,
        status: 'PENDING_APPROVER',
        currentPosition: 1,
        chainCustomised,
        invoiceNumber: input.invoiceNumber,
        vendorName: input.vendorName,
        invoiceDate: input.invoiceDate,
        amount: input.amount,
        currency: input.currency,
        notes: input.notes,
      });

      await tx.insert(workflowSteps).values([
        ...chain.map((a) => ({
          workflowId,
          position: a.position,
          employeeId: a.employeeId,
          employeeName: a.name,
          employeeEmail: a.email,
          status: a.position === 1 ? ('PENDING' as const) : ('WAITING' as const),
          activatedAt: a.position === 1 ? new Date() : null,
        })),
        {
          workflowId,
          position: cfoPosition,
          employeeId: cfo.id,
          employeeName: cfo.name,
          employeeEmail: cfo.email,
          isCfo: true,
          status: 'WAITING' as const,
        },
      ]);

      await tx.insert(auditEvents).values({
        workflowId,
        actorId: creatorId,
        eventType: 'SUBMITTED',
        payload: {
          companyId: company.id,
          chainCustomised,
          fileSha256,
          chain: [
            ...chain.map((a) => ({ position: a.position, employeeId: a.employeeId, name: a.name })),
            { position: cfoPosition, employeeId: cfo.id, name: cfo.name, cfo: true },
          ],
        },
      });
      // "Your turn" for everyone at step 1 (plan.md §4.6), delivered after commit
      const outboxIds = await enqueue(
        tx,
        yourTurnMessages(
          workflowId,
          1,
          chain
            .filter((a) => a.position === 1)
            .map((a) => ({ employeeId: a.employeeId, employeeEmail: a.email, isCfo: false })),
          { fileName: upload.fileName, companyName: company.name },
        ),
      );
      return { id: workflowId, outboxIds };
    });
    // The upload copy has done its job; a leftover is cleaned up by the tick or B2 lifecycle
    await storage.delete(upload.objectKey).catch(() => undefined);
    return result;
  } catch (err) {
    await dropCopy();
    if (isUniqueViolation(err, 'workflows_upload_unique')) {
      throw conflict('ALREADY_SUBMITTED', 'This document was already submitted.');
    }
    throw err;
  }
}
