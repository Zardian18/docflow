import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Db } from './db/client.js';
import { DEMO_PASSWORD, demoEmail, seedDemo } from './demo/seed.js';
import { MemoryStorage } from './storage/memory.js';
import { Client, resetDb, setupTestDb, TEST_DB_URL, testApp } from './test-db.js';

type Item = { fileName: string };
const names = (body: { items: Item[] }) => body.items.map((i) => i.fileName);

/** Filters and sort on the Creator, Approver and CFO lists, run on the demo data set. */
describe.skipIf(!TEST_DB_URL)('list filters and sort', () => {
  let db: Db;
  let end: () => Promise<void>;
  let app: Awaited<ReturnType<typeof testApp>>;
  const storage = new MemoryStorage();
  const as: Record<string, Client> = {};
  let company: Record<string, string>;

  beforeAll(async () => {
    const setup = await setupTestDb();
    db = setup.db;
    end = () => setup.pool.end();
    app = await testApp(db, {}, storage);
    await resetDb(db);
    await seedDemo(db, storage);
    for (const who of ['rahul', 'dev', 'meera', 'cfo']) {
      as[who] = await new Client(app).login(demoEmail(who), DEMO_PASSWORD);
    }
    const mine = (await as.rahul!.get('/v1/workflows/mine')).json();
    company = Object.fromEntries(
      mine.companies.map((c: { id: string; name: string }) => [c.name.split(' ')[0], c.id]),
    );
  });
  afterAll(async () => {
    await app.close();
    await end();
  });

  describe('My Submissions', () => {
    const mine = async (query = '') => (await as.rahul!.get(`/v1/workflows/mine${query}`)).json();

    it('lists the companies of all my documents, for the Company filter', async () => {
      expect((await mine()).companies.map((c: { name: string }) => c.name)).toEqual([
        'Microtech Pvt Ltd',
        'Nimbus Traders',
        'Orbit Logistics',
      ]);
    });

    it('filters by status, company, search and date, and sorts', async () => {
      expect(names(await mine('?status=REJECTED'))).toEqual(['Consulting_Invoice_Aug.pdf']);
      expect(names(await mine(`?companyId=${company.Orbit}`))).toEqual([
        'Freight_Charges_Sept.pdf',
      ]);
      // Search covers the vendor and invoice number too
      expect(names(await mine('?q=vertex'))).toEqual(['Consulting_Invoice_Aug.pdf']);
      const future = encodeURIComponent(new Date(Date.now() + 86_400_000).toISOString());
      expect((await mine(`?submittedFrom=${future}`)).total).toBe(0);
      expect(names(await mine('?sort=document&dir=asc'))).toEqual([
        'Consulting_Invoice_Aug.pdf',
        'Freight_Charges_Sept.pdf',
        'Q3_Vendor_Invoice.pdf',
        'Server_Hardware_PO.pdf',
      ]);
      // Filters combine, and the Company list stays complete
      const both = await mine(`?status=PENDING_APPROVER&companyId=${company.Microtech}`);
      expect(names(both)).toEqual(['Q3_Vendor_Invoice.pdf']);
      expect(both.companies).toHaveLength(3);
    });

    it('refuses an unknown sort', async () => {
      expect((await as.rahul!.get('/v1/workflows/mine?sort=amount')).statusCode).toBe(400);
    });
  });

  describe('Approval History', () => {
    const history = async (query = '') =>
      (await as.dev!.get(`/v1/approvals/history${query}`)).json();

    it('filters by my decision, the document’s status, company and search', async () => {
      expect(names(await history('?decision=REJECTED'))).toEqual(['Marketing_Retainer.pdf']);
      expect(names(await history('?status=COMPLETED'))).toEqual(['Annual_Audit_Fees.pdf']);
      expect(names(await history(`?companyId=${company.Nimbus}&sort=document&dir=asc`))).toEqual([
        'Annual_Audit_Fees.pdf',
        'Consulting_Invoice_Aug.pdf',
      ]);
      expect(names(await history('?q=portside'))).toEqual(['Warehouse_Rent_Oct.pdf']);
      expect((await history()).total).toBe(5);
    });
  });

  describe('Pending', () => {
    it('filters and sorts, while the cards keep counting everything', async () => {
      const all = (await as.meera!.get('/v1/approvals/pending?sort=document&dir=asc')).json();
      expect(all.items.map((i: Item) => i.fileName)).toEqual([
        'IT_Support_Contract.pdf',
        'Travel_Reimbursement_Q3.pdf',
      ]);
      const nimbus = (
        await as.meera!.get(`/v1/approvals/pending?companyId=${company.Nimbus}`)
      ).json();
      expect(nimbus.items.map((i: Item) => i.fileName)).toEqual(['Travel_Reimbursement_Q3.pdf']);
      expect(nimbus.stats.awaiting).toBe(2);
      expect(nimbus.companies).toHaveLength(2);
    });
  });

  describe('Rejected before final approval (CFO)', () => {
    it('filters by company and search', async () => {
      const all = (await as.cfo!.get('/v1/approvals/rejected-before-final')).json();
      expect(names(all)).toEqual(['Marketing_Retainer.pdf']);
      expect(all.companies.map((c: { name: string }) => c.name)).toEqual(['Orbit Logistics']);
      const none = (
        await as.cfo!.get(`/v1/approvals/rejected-before-final?companyId=${company.Nimbus}`)
      ).json();
      expect(none.total).toBe(0);
    });
  });
});
