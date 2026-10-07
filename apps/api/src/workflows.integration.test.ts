import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, createEmployee, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const pdfBytes = (n = 64) =>
  Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(Math.max(0, n - 9), 0x20)]);
const docxBytes = (n = 64) =>
  Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(n - 4, 1)]);

describe.skipIf(!TEST_DB_URL)('creator submission', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  let storage: MemoryStorage;
  let admin: Client;
  let creator: Client;
  let ids: Record<string, string>;
  let companyId: string;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    storage = new MemoryStorage();
    app = await testApp(db, {}, storage);
  });
  afterAll(async () => {
    await app.close();
    await end();
  });

  beforeEach(async () => {
    await resetDb(db);
    storage.objects.clear();
    storage.deleted.length = 0;
    ids = {
      admin: await createEmployee(db, {
        name: 'A. Mehta',
        email: 'admin@t.co',
        permission: 'ADMIN',
      }),
      creator: await createEmployee(db, {
        name: 'R. Creator',
        email: 'creator@t.co',
        permission: 'CREATOR',
      }),
      other: await createEmployee(db, {
        name: 'O. Creator',
        email: 'other@t.co',
        permission: 'CREATOR',
      }),
      a: await createEmployee(db, {
        name: 'Ann Approver',
        email: 'a@t.co',
        permission: 'APPROVER',
      }),
      b: await createEmployee(db, {
        name: 'Bob Approver',
        email: 'b@t.co',
        permission: 'APPROVER',
      }),
      c: await createEmployee(db, { name: 'Cy Approver', email: 'c@t.co', permission: 'APPROVER' }),
      cfo: await createEmployee(db, { name: 'V. Malhotra', email: 'cfo@t.co', permission: 'CFO' }),
    };
    admin = await new Client(app).login('admin@t.co');
    creator = await new Client(app).login('creator@t.co');
    const res = await admin.post('/v1/companies', {
      name: 'Microtech Pvt Ltd',
      code: 'MIC',
      approvers: [
        { employeeId: ids.a, position: 1 },
        { employeeId: ids.b, position: 2 },
      ],
    });
    companyId = res.json().id;
  });

  /** Presign + simulate the browser's PUT. Returns the upload id. */
  async function upload(
    client = creator,
    body = pdfBytes(),
    name = 'Q3_Invoice.pdf',
    type = PDF,
    declared = body.length,
  ) {
    const res = await client.post('/v1/uploads/presign', {
      fileName: name,
      contentType: type,
      size: declared,
    });
    expect(res.statusCode, res.body).toBe(200);
    const { uploadId } = res.json();
    const [row] = (await db.execute(sql`select object_key from uploads where id = ${uploadId}`))
      .rows as { object_key: string }[];
    storage.upload(row!.object_key, body, type);
    return uploadId as string;
  }

  const submit = (
    uploadId: string,
    approvers: Array<[string, number]>,
    extra: Record<string, unknown> = {},
    client = creator,
  ) =>
    client.post('/v1/workflows', {
      uploadId,
      companyId,
      approvers: approvers.map(([employeeId, position]) => ({ employeeId, position })),
      ...extra,
    });

  describe('presign', () => {
    it('gives a Creator a signed upload URL for a PDF or DOCX', async () => {
      const res = await creator.post('/v1/uploads/presign', {
        fileName: 'a.docx',
        contentType: DOCX,
        size: 1000,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ headers: { 'content-type': DOCX } });
    });

    it('refuses other types and files over 10 MB', async () => {
      expect(
        (
          await creator.post('/v1/uploads/presign', {
            fileName: 'a.exe',
            contentType: PDF,
            size: 10,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await creator.post('/v1/uploads/presign', {
            fileName: 'a.pdf',
            contentType: PDF,
            size: 10 * 1024 * 1024 + 1,
          })
        ).statusCode,
      ).toBe(400);
    });

    it('is for Creators only', async () => {
      expect(
        (await admin.post('/v1/uploads/presign', { fileName: 'a.pdf', contentType: PDF, size: 10 }))
          .statusCode,
      ).toBe(403);
      const approver = await new Client(app).login('a@t.co');
      expect(
        (
          await approver.post('/v1/uploads/presign', {
            fileName: 'a.pdf',
            contentType: PDF,
            size: 10,
          })
        ).statusCode,
      ).toBe(403);
    });
  });

  describe('submit', () => {
    it('creates the workflow with a snapshot: step 1 pending, CFO last and alone', async () => {
      const res = await submit(
        await upload(),
        [
          [ids.a!, 1],
          [ids.b!, 2],
        ],
        { invoiceNumber: 'INV-884', amount: '1,25,000.50', vendorName: 'Acme' },
      );
      expect(res.statusCode, res.body).toBe(201);
      const detail = (await creator.get(`/v1/workflows/${res.json().id}`)).json();
      expect(detail).toMatchObject({
        status: 'PENDING_APPROVER',
        currentPosition: 1,
        currentWith: ['Ann Approver'],
        chainCustomised: false,
        invoiceNumber: 'INV-884',
        amount: '125000.50',
        currency: 'INR',
        fileName: 'Q3_Invoice.pdf',
      });
      expect(
        detail.steps.map(
          (s: { name: string; position: number; status: string; isCfo: boolean }) => [
            s.position,
            s.name,
            s.status,
            s.isCfo,
          ],
        ),
      ).toEqual([
        [1, 'Ann Approver', 'PENDING', false],
        [2, 'Bob Approver', 'WAITING', false],
        [3, 'V. Malhotra', 'WAITING', true],
      ]);
      expect(detail.events).toMatchObject([{ type: 'SUBMITTED', actorName: 'R. Creator' }]);
    });

    it('supports a parallel first step: everyone in it is pending', async () => {
      const res = await submit(await upload(), [
        [ids.a!, 1],
        [ids.c!, 1],
        [ids.b!, 2],
      ]);
      const detail = (await creator.get(`/v1/workflows/${res.json().id}`)).json();
      expect(detail.currentWith).toEqual(['Ann Approver', 'Cy Approver']);
      expect(detail.chainCustomised).toBe(true);
      expect(detail.steps.find((s: { isCfo: boolean }) => s.isCfo).position).toBe(3);
    });

    it('customising the chain never changes the company default (invariant 3)', async () => {
      await submit(await upload(), [
        [ids.c!, 1],
        [ids.b!, 2],
      ]);
      const company = (await admin.get(`/v1/companies/${companyId}`)).json();
      expect(company.approvers.map((a: { name: string }) => a.name)).toEqual([
        'Ann Approver',
        'Bob Approver',
      ]);
    });

    it('later master edits never change the snapshot (invariant 2)', async () => {
      const id = (
        await submit(await upload(), [
          [ids.a!, 1],
          [ids.b!, 2],
        ])
      ).json().id;
      await admin.put(`/v1/companies/${companyId}`, {
        name: 'Microtech Pvt Ltd',
        code: 'MIC',
        approvers: [
          { employeeId: ids.c, position: 1 },
          { employeeId: ids.b, position: 2 },
        ],
      });
      await db.execute(sql`update employees set name = 'Renamed' where id = ${ids.a}`);
      const detail = (await creator.get(`/v1/workflows/${id}`)).json();
      expect(detail.steps.map((s: { name: string }) => s.name)).toEqual([
        'Ann Approver',
        'Bob Approver',
        'V. Malhotra',
      ]);
    });

    it('keeps at least 2 approvers before the CFO (D3d)', async () => {
      const res = await submit(await upload(), [[ids.a!, 1]]);
      expect(res.statusCode).toBe(400);
      expect(res.json().details.errors).toContainEqual({ code: 'TOO_FEW_APPROVERS', min: 2 });
    });

    it('refuses the Creator, the CFO or a non-approver in the chain', async () => {
      for (const bad of [ids.creator!, ids.cfo!, ids.other!]) {
        const res = await submit(await upload(), [
          [ids.a!, 1],
          [bad, 2],
        ]);
        expect(res.json().error).toBe('INELIGIBLE_APPROVER');
      }
    });

    it('refuses an inactive company', async () => {
      await admin.put(`/v1/companies/${companyId}`, {
        name: 'Microtech Pvt Ltd',
        code: 'MIC',
        isActive: false,
        approvers: [
          { employeeId: ids.a, position: 1 },
          { employeeId: ids.b, position: 2 },
        ],
      });
      const res = await submit(await upload(), [
        [ids.a!, 1],
        [ids.b!, 2],
      ]);
      expect(res.json().error).toBe('COMPANY_UNAVAILABLE');
    });

    it('is blocked while there is no active CFO (D18)', async () => {
      await db.execute(sql`update employees set is_active = false where id = ${ids.cfo}`);
      const res = await submit(await upload(), [
        [ids.a!, 1],
        [ids.b!, 2],
      ]);
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('NO_ACTIVE_CFO');
    });
  });

  describe('file checks', () => {
    it('refuses an upload that never arrived', async () => {
      const res = await creator.post('/v1/uploads/presign', {
        fileName: 'a.pdf',
        contentType: PDF,
        size: 64,
      });
      const out = await submit(res.json().uploadId, [
        [ids.a!, 1],
        [ids.b!, 2],
      ]);
      expect(out.json().error).toBe('UPLOAD_INCOMPLETE');
    });

    it('deletes and refuses a file whose size differs from what was declared', async () => {
      const id = await upload(creator, pdfBytes(80), 'a.pdf', PDF, 64);
      const out = await submit(id, [
        [ids.a!, 1],
        [ids.b!, 2],
      ]);
      expect(out.json().error).toBe('FILE_SIZE_MISMATCH');
      expect(storage.deleted).toHaveLength(1);
    });

    it('deletes and refuses a file whose contents are not really a PDF', async () => {
      const fake = Buffer.from('<html>not a pdf</html>'.padEnd(64));
      const out = await submit(await upload(creator, fake, 'evil.pdf'), [
        [ids.a!, 1],
        [ids.b!, 2],
      ]);
      expect(out.json().error).toBe('FILE_TYPE_MISMATCH');
      expect(storage.deleted).toHaveLength(1);
    });

    it('accepts a real DOCX (zip) file', async () => {
      const out = await submit(await upload(creator, docxBytes(), 'Contract.docx', DOCX), [
        [ids.a!, 1],
        [ids.b!, 2],
      ]);
      expect(out.statusCode).toBe(201);
    });

    it('refuses another Creator’s upload', async () => {
      const otherClient = await new Client(app).login('other@t.co');
      const theirs = await upload(otherClient);
      expect(
        (
          await submit(theirs, [
            [ids.a!, 1],
            [ids.b!, 2],
          ])
        ).json().error,
      ).toBe('UPLOAD_NOT_FOUND');
    });

    it('a double submit creates exactly one workflow', async () => {
      const id = await upload();
      const chain: Array<[string, number]> = [
        [ids.a!, 1],
        [ids.b!, 2],
      ];
      const results = await Promise.all([submit(id, chain), submit(id, chain)]);
      // One wins; the other is refused (already submitted, or the upload is no longer usable)
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode >= 400 && r.statusCode < 500)).toHaveLength(1);
      const { rows } = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from workflows`,
      );
      expect(rows[0]?.n).toBe(1);
    });
  });

  describe('visibility', () => {
    let workflowId: string;
    beforeEach(async () => {
      workflowId = (
        await submit(await upload(), [
          [ids.a!, 1],
          [ids.b!, 2],
        ])
      ).json().id;
    });

    it('My Submissions lists only the caller’s own documents', async () => {
      const otherClient = await new Client(app).login('other@t.co');
      expect((await creator.get('/v1/workflows/mine')).json().total).toBe(1);
      expect((await otherClient.get('/v1/workflows/mine')).json().total).toBe(0);
    });

    it('another Creator gets 404 for the document and its file', async () => {
      const otherClient = await new Client(app).login('other@t.co');
      expect((await otherClient.get(`/v1/workflows/${workflowId}`)).statusCode).toBe(404);
      expect((await otherClient.get(`/v1/workflows/${workflowId}/file`)).statusCode).toBe(404);
    });

    it('the owner and Admin get a short-lived file link', async () => {
      for (const client of [creator, admin]) {
        const res = await client.get(`/v1/workflows/${workflowId}/file`);
        expect(res.statusCode).toBe(200);
        expect(res.json().url).toContain('Q3_Invoice.pdf');
      }
    });

    it('approvers and the CFO cannot see it yet (their access arrives with Phase 4)', async () => {
      const approver = await new Client(app).login('a@t.co');
      expect((await approver.get(`/v1/workflows/${workflowId}`)).statusCode).toBe(403);
      expect((await approver.get('/v1/workflows/mine')).statusCode).toBe(403);
    });

    it('audit events cannot be edited or deleted (invariant 7)', async () => {
      // drizzle wraps the driver error; the trigger's message is on the cause
      const appendOnly = {
        cause: expect.objectContaining({ message: expect.stringMatching(/append-only/) }),
      };
      await expect(db.execute(sql`update audit_events set event_type = 'X'`)).rejects.toMatchObject(
        appendOnly,
      );
      await expect(db.execute(sql`delete from audit_events`)).rejects.toMatchObject(appendOnly);
    });
  });

  describe('lookups', () => {
    it('company search: Active only, prefix of name or code, case-insensitive', async () => {
      await admin.post('/v1/companies', {
        name: 'Orion Industries',
        code: 'ORI',
        isActive: false,
        approvers: [
          { employeeId: ids.a, position: 1 },
          { employeeId: ids.b, position: 2 },
        ],
      });
      const byCode = (await creator.get('/v1/companies/search?q=mi')).json();
      expect(byCode.companies.map((c: { name: string }) => c.name)).toEqual(['Microtech Pvt Ltd']);
      expect(byCode.companies[0].approvers).toHaveLength(2);
      expect(byCode.cfo).toMatchObject({ name: 'V. Malhotra' });
      expect((await creator.get('/v1/companies/search?q=ori')).json().companies).toEqual([]);
      expect((await creator.get('/v1/companies/search?q=tech')).json().companies).toEqual([]);
    });

    it('Creators can search approvers; approvers and the CFO cannot', async () => {
      expect(
        (await creator.get('/v1/employees/approver-search?q=a'))
          .json()
          .map((e: { name: string }) => e.name),
      ).toEqual(['Ann Approver']);
      const approver = await new Client(app).login('a@t.co');
      expect((await approver.get('/v1/employees/approver-search?q=a')).statusCode).toBe(403);
      expect((await approver.get('/v1/companies/search?q=m')).statusCode).toBe(403);
    });
  });
});
