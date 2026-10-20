import { randomUUID } from 'node:crypto';
import type { Capability, DocKind, Slot, TaskActionRequest, Team } from '@docflow/shared';
import { TaskActionRequest as ActionSchema, ComponentInput, OrderCreate } from '@docflow/shared';
import { count, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/sessions.js';
import { hashPassword } from '../auth/crypto.js';
import type { Db } from '../db/client.js';
import {
  buyers,
  companies,
  companySlotGates,
  companySlotPeople,
  employeeCapabilities,
  employees,
  orders,
  tasks,
  teamMembers,
  uploads,
} from '../db/schema.js';
import { addComponent, updateComponent } from '../engine/components.js';
import { act, createOrder } from '../engine/engine.js';
import type { StorageService } from '../storage/storage.js';

/** The demo password for development and CI. The live site gets a random one (`--live`). */
export const DEMO_PASSWORD = 'demo-password-1';
export const DEMO_DOMAIN = 'demo.docflow.test';
export const demoEmail = (key: string) => `${key}@${DEMO_DOMAIN}`;

interface Person {
  key: string;
  name: string;
  teams?: Team[];
  capabilities?: Capability[];
}

/**
 * The v2 demo cast (D24): named people for the approval chains, and team members, some of
 * them in two teams at once.
 */
export const PEOPLE: Person[] = [
  { key: 'admin', name: 'Anita Mehta', capabilities: ['ADMIN'] },
  { key: 'rohan', name: 'Rohan Kapoor', capabilities: ['MARKETING'] },
  { key: 'nisha', name: 'Nisha Verma', capabilities: ['MARKETING'] },
  { key: 'sara', name: 'Sara Khan', capabilities: ['CREATOR'] },
  { key: 'rahul', name: 'Rahul Mehra', capabilities: ['CREATOR'] },
  { key: 'priya', name: 'Priya Shah', capabilities: ['APPROVER'] },
  { key: 'arjun', name: 'Arjun Nair', capabilities: ['APPROVER'] },
  { key: 'vikram', name: 'Vikram Malhotra', capabilities: ['HEAD_APPROVER'] },
  { key: 'meera', name: 'Meera Kulkarni', capabilities: ['HEAD_APPROVER'] },
  { key: 'dev', name: 'Dev Iyer', teams: ['REGULATION', 'PRODUCTION'] },
  { key: 'lina', name: 'Lina Fernandes', teams: ['REGULATION'] },
  { key: 'kabir', name: 'Kabir Singh', teams: ['MATERIALS'] },
  { key: 'neha', name: 'Neha Joshi', teams: ['MATERIALS', 'DESIGN'] },
  { key: 'ananya', name: 'Ananya Rao', teams: ['DESIGN'] },
  { key: 'farhan', name: 'Farhan Ali', teams: ['PRODUCTION'] },
  { key: 'pooja', name: 'Pooja Desai', teams: ['ACCOUNTS'] },
  { key: 'imran', name: 'Imran Shaikh', teams: ['LOGISTICS'] },
  { key: 'tara', name: 'Tara Menon', teams: ['LOGISTICS', 'ACCOUNTS'] },
];

const COMPANIES: Array<{
  key: string;
  name: string;
  code: string;
  slots: Array<[Slot, string[], ('ALL' | 'ANY')?]>;
}> = [
  {
    key: 'tpe',
    name: 'Trident Pharma Exports',
    code: 'TPE',
    slots: [
      ['MARKETING', ['rohan']],
      ['CREATOR', ['sara']],
      ['PI_APPROVER', ['priya']],
      ['PI_HEAD', ['vikram'], 'ALL'],
      ['PAY_APPROVER', ['arjun']],
      ['PAY_HEAD', ['vikram', 'meera'], 'ANY'],
      ['BOL_APPROVER', ['priya']],
      ['BOL_HEAD', ['vikram', 'meera'], 'ALL'],
    ],
  },
  {
    key: 'thc',
    name: 'Trident Healthcare',
    code: 'THC',
    slots: [
      ['MARKETING', ['nisha']],
      ['CREATOR', ['rahul']],
      ['PI_APPROVER', ['arjun']],
      ['PI_HEAD', ['meera'], 'ALL'],
      ['PAY_APPROVER', ['priya']],
      ['PAY_HEAD', ['meera'], 'ALL'],
      ['BOL_APPROVER', ['arjun']],
      ['BOL_HEAD', ['vikram', 'meera'], 'ANY'],
    ],
  },
];

const BUYERS = [
  {
    key: 'alnoor',
    name: 'Al Noor Medical',
    country: 'United Arab Emirates',
    address: 'Al Quoz Industrial 3, Dubai',
  },
  {
    key: 'kenya',
    name: 'Kenya Health Supplies',
    country: 'Kenya',
    address: 'Mombasa Road, Nairobi',
  },
  {
    key: 'medline',
    name: 'MedLine Philippines',
    country: 'Philippines',
    address: 'Ortigas Center, Pasig City',
  },
  { key: 'andes', name: 'Andes Pharma', country: 'Peru', address: 'Av. Javier Prado 1450, Lima' },
];

/** A small, valid one-page PDF showing `title`, so "View" opens something real. */
export function demoPdf(title: string): Buffer {
  const text = title.replace(/[()\\]/g, '');
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET\nBT /F1 11 Tf 72 690 Td (DocFlow demo document) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

const DAY = 86_400_000;
const daysAgo = (n: number, now = Date.now()) => new Date(now - n * DAY).toISOString().slice(0, 10);

/**
 * Loads the v2 demo through the real engine, so every state is one the app can reach. Each
 * order is then spread over realistic days (see `spreadOverDays`), so waiting times and
 * Tracker C read like real work. By default adds a demo Admin and needs an empty database;
 * with `withAdmin: false` (the live site, after reset:data) only Admins may exist beforehand.
 */
export async function seedDemo(
  db: Db,
  storage: StorageService,
  { password = DEMO_PASSWORD, withAdmin = true }: { password?: string; withAdmin?: boolean } = {},
) {
  const [{ others } = { others: 0 }] = await db
    .select({ others: count() })
    .from(employees)
    .where(
      withAdmin
        ? undefined
        : sql`not exists (select 1 from ${employeeCapabilities} c where c.employee_id = ${employees.id} and c.capability = 'ADMIN')`,
    );
  const [{ n: orderCount } = { n: 0 }] = await db.select({ n: count() }).from(orders);
  const [{ n: companyCount } = { n: 0 }] = await db.select({ n: count() }).from(companies);
  if (others + orderCount + companyCount > 0) {
    throw new Error(
      withAdmin
        ? 'seed:demo only runs on an empty database (it found existing data)'
        : 'seed:demo --live only runs right after reset:data (it found existing data)',
    );
  }

  const passwordHash = await hashPassword(password);
  const users: Record<string, AuthUser> = {};
  for (const p of PEOPLE.filter((p) => withAdmin || p.key !== 'admin')) {
    const [row] = await db
      .insert(employees)
      .values({ name: p.name, email: demoEmail(p.key), passwordHash })
      .returning({ id: employees.id });
    const id = row!.id;
    if (p.teams?.length)
      await db.insert(teamMembers).values(p.teams.map((team) => ({ employeeId: id, team })));
    if (p.capabilities?.length) {
      await db
        .insert(employeeCapabilities)
        .values(p.capabilities.map((capability) => ({ employeeId: id, capability })));
    }
    users[p.key] = {
      id,
      sessionId: 'seed',
      name: p.name,
      email: demoEmail(p.key),
      employeeCode: null,
      teams: p.teams ?? [],
      capabilities: p.capabilities ?? [],
    };
  }

  const companyIds: Record<string, string> = {};
  for (const c of COMPANIES) {
    const [row] = await db
      .insert(companies)
      .values({ name: c.name, code: c.code })
      .returning({ id: companies.id });
    companyIds[c.key] = row!.id;
    for (const [slot, keys, gate] of c.slots) {
      await db.insert(companySlotPeople).values(
        keys.map((k, ordinal) => ({
          companyId: row!.id,
          slot,
          employeeId: users[k]!.id,
          ordinal,
        })),
      );
      if (gate) await db.insert(companySlotGates).values({ companyId: row!.id, slot, gate });
    }
  }
  const buyerIds: Record<string, string> = {};
  for (const b of BUYERS) {
    const [row] = await db
      .insert(buyers)
      .values({ name: b.name, country: b.country, address: b.address })
      .returning({ id: buyers.id });
    buyerIds[b.key] = row!.id;
  }

  // ---- Helpers that drive the engine as a person would ----------------------------------

  async function file(who: string, kind: DocKind, name: string) {
    const id = randomUUID();
    const body = demoPdf(name.replace(/_/g, ' ').replace(/\.pdf$/, ''));
    const objectKey = `uploads/${users[who]!.id}/${id}`;
    await db.insert(uploads).values({
      id,
      objectKey,
      createdBy: users[who]!.id,
      fileName: name,
      fileMime: 'application/pdf',
      fileSize: body.length,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await storage.put(objectKey, body, 'application/pdf');
    return { uploadId: id, kind };
  }

  /** One order, recording a virtual day for each step so the timeline can be spread out */
  async function order(
    key: string,
    companyKey: string,
    buyerKey: string,
    notes: string,
    startDaysAgo: number,
  ) {
    const marks: Array<{ real: Date; day: number }> = [];
    let day = 0;
    // The database and app clocks can differ by a few milliseconds, so each moment is
    // padded on both sides: everything an action writes then falls between its mark and the next
    const pause = () => new Promise((r) => setTimeout(r, 40));
    const mark = async (advance: number) => {
      await pause();
      day += advance;
      marks.push({ real: new Date(), day });
      await pause();
    };
    marks.push({ real: new Date(Date.now() - 1000), day: 0 });
    await pause();
    const marketing = COMPANIES.find((c) => c.key === companyKey)!.slots.find(
      (s) => s[0] === 'MARKETING',
    )![1][0]!;
    const id = await createOrder(
      db,
      users[marketing]!,
      OrderCreate.parse({ buyerId: buyerIds[buyerKey], companyId: companyIds[companyKey], notes }),
    );
    const taskOf = async (stepKey: string, product?: string) => {
      const rows = await db.execute<{ id: string; name: string | null }>(sql`
        select t.id, p.name from ${tasks} t left join order_products p on p.id = t.product_id
         where t.order_id = ${id} and t.step_key = ${stepKey}`);
      const row = rows.rows.find((r) => product === undefined || r.name === product);
      if (!row) throw new Error(`demo: no task ${stepKey} ${product ?? ''} on ${key}`);
      return row.id;
    };
    /** Do something after `after` days (fractions allowed), as `who` */
    const step = async (
      after: number,
      who: string,
      stepKey: string,
      body: TaskActionRequest,
      product?: string,
    ) => {
      await mark(after);
      await act(db, storage, users[who]!, await taskOf(stepKey, product), ActionSchema.parse(body));
    };
    return {
      id,
      step,
      marks,
      startDaysAgo,
      key,
      mark,
      products: async () => {
        const rows = await db.execute<{ id: string; name: string }>(
          sql`select id, name from order_products where order_id = ${id} order by position`,
        );
        return rows.rows;
      },
    };
  }
  type O = Awaited<ReturnType<typeof order>>;

  const payment = (amount: string, currency = 'USD') => ({
    receivedOn: daysAgo(0),
    amount,
    currency,
    reference: `TT-${amount.slice(0, 4)}`,
  });

  async function phase1(
    o: O,
    who: { creator: string; mkt: string; approver: string; heads: string[] },
    products: string[],
    opts: { rejectPi?: boolean; stop?: 'head' | 'advance' } = {},
  ) {
    await o.step(0.3, who.creator, 'cbm', {
      action: 'SUBMIT',
      uploads: [await file(who.creator, 'CBM', 'CBM_v1.pdf')],
    });
    await o.step(1, who.mkt, 'cbm', {
      action: 'RETURN',
      comment: 'Use 40ft HC containers; recheck carton count',
    });
    await o.step(1, who.creator, 'cbm', {
      action: 'SUBMIT',
      uploads: [await file(who.creator, 'CBM', 'CBM_v2.pdf')],
      comment: 'Updated for 40ft HC',
    });
    await o.step(0.5, who.mkt, 'cbm', { action: 'CONFIRM' });
    await o.step(1, who.mkt, 'cbm_buyer_confirmed', {
      action: 'LOG',
      comment: 'Confirmed on call',
    });
    await o.step(1, who.creator, 'pi', {
      action: 'COMPLETE',
      products,
      uploads: [
        await file(who.creator, 'PI_FULL', 'PI_full.pdf'),
        await file(who.creator, 'PI_NO_RATES', 'PI_quantities_only.pdf'),
      ],
    });
    await o.step(0.5, who.mkt, 'pi_approval', { action: 'APPROVE' });
    if (opts.rejectPi) {
      await o.step(1, who.approver, 'pi_approval', {
        action: 'REJECT',
        comment: 'Freight terms should be CIF, not FOB',
      });
      await o.step(1, who.creator, 'pi', {
        action: 'COMPLETE',
        products,
        uploads: [await file(who.creator, 'PI_FULL', 'PI_full_v2.pdf')],
        comment: 'Changed to CIF',
      });
      await o.step(0.5, who.mkt, 'pi_approval', { action: 'APPROVE' });
    }
    await o.step(1, who.approver, 'pi_approval', { action: 'APPROVE' });
    if (opts.stop === 'head') return;
    for (const h of who.heads) await o.step(0.5, h, 'pi_approval', { action: 'APPROVE' });
    await o.step(0.5, who.mkt, 'advance_requested', { action: 'LOG' });
    if (opts.stop === 'advance') return;
    await o.step(2, 'pooja', 'advance_verified', { action: 'COMPLETE', payment: payment('30000') });
  }

  async function components(
    o: O,
    rows: Record<string, Array<[string, 'RAW_MATERIAL' | 'PACKAGING', string, string]>>,
    deliver: (name: string) => boolean,
  ) {
    for (const p of await o.products()) {
      for (const [name, kind, po, made] of rows[p.name] ?? []) {
        await o.mark(0.2);
        const id = await addComponent(
          db,
          users.kabir!,
          o.id,
          p.id,
          ComponentInput.parse({
            name,
            kind,
            poQuantity: po,
            orderQuantity: made,
            poDate: daysAgo(o.startDaysAgo - 8),
          }),
        );
        if (deliver(name)) {
          await o.mark(1.5);
          await updateComponent(
            db,
            users.kabir!,
            id,
            ComponentInput.parse({
              name,
              kind,
              poQuantity: po,
              orderQuantity: made,
              poDate: daysAgo(o.startDaysAgo - 8),
              dispatchDate: daysAgo(Math.max(0, o.startDaysAgo - 13)),
              deliverDate: daysAgo(Math.max(0, o.startDaysAgo - 15)),
              lrDetails: `LR-${Math.floor(10000 + Math.random() * 89999)}`,
              challanNo: `CH-${Math.floor(1000 + Math.random() * 8999)}`,
              tnsRemark: made !== po ? 'Run within ±2%' : null,
            }),
          );
        }
      }
    }
  }

  async function phase2(
    o: O,
    rows: Parameters<typeof components>[1],
    stopAt: 'loops' | 'delivery' | 'qa' | 'end',
  ) {
    const products = await o.products();
    for (const p of products) {
      await o.step(
        0.5,
        'kabir',
        'annexure',
        { action: 'SUBMIT', uploads: [await file('kabir', 'ANNEXURE', `Annexure_${p.name}.pdf`)] },
        p.name,
      );
      await o.step(
        0.5,
        'ananya',
        'artwork',
        { action: 'SUBMIT', uploads: [await file('ananya', 'ARTWORK', `Artwork_${p.name}.pdf`)] },
        p.name,
      );
    }
    const [first, ...rest] = products;
    await o.step(
      2,
      'lina',
      'annexure',
      { action: 'RETURN', comment: 'Batch number and expiry format missing' },
      first!.name,
    );
    await o.step(
      1,
      'kabir',
      'annexure',
      {
        action: 'SUBMIT',
        uploads: [await file('kabir', 'ANNEXURE', `Annexure_${first!.name}_v2.pdf`)],
        comment: 'Added batch and expiry',
      },
      first!.name,
    );
    await o.step(
      0.5,
      'neha',
      'raw_material',
      { action: 'COMPLETE', comment: 'PO raised with API supplier' },
      first!.name,
    );
    await o.step(1, 'dev', 'artwork', { action: 'CONFIRM' }, first!.name);
    if (stopAt === 'loops') return;
    await o.step(1, 'lina', 'annexure', { action: 'CONFIRM' }, first!.name);
    for (const p of rest) {
      await o.step(0.5, 'dev', 'annexure', { action: 'CONFIRM' }, p.name);
      await o.step(0.5, 'lina', 'artwork', { action: 'CONFIRM' }, p.name);
      await o.step(0.5, 'kabir', 'raw_material', { action: 'COMPLETE' }, p.name);
    }
    for (const p of products)
      await o.step(
        1,
        'kabir',
        'packaging',
        { action: 'COMPLETE', comment: 'Printing started' },
        p.name,
      );
    const allDelivered = stopAt !== 'delivery';
    let skipped = false;
    await components(o, rows, () => {
      if (allDelivered) return true;
      if (!skipped) {
        skipped = true;
        return false;
      }
      return true;
    });
    if (stopAt === 'delivery') return;
    await o.step(1, 'farhan', 'production_qa', {
      action: 'RETURN',
      toTeam: 'MATERIALS',
      comment: 'Two cartons damaged in transit',
    });
    if (stopAt === 'qa') return;
    await o.step(1, 'neha', 'production_qa', {
      action: 'SUBMIT',
      comment: 'Replaced damaged cartons',
    });
    await o.step(1, 'dev', 'production_qa', { action: 'CONFIRM', comment: 'Materials fine' });
  }

  const ROWS = {
    'Paracetamol 500mg Tablets': [
      ['Paracetamol API', 'RAW_MATERIAL', '250 kg', '250 kg'],
      ['Microcrystalline cellulose', 'RAW_MATERIAL', '80 kg', '80 kg'],
      ['Blister foil', 'PACKAGING', '12,000', '12,240'],
      ['Carton 10×10', 'PACKAGING', '5,000', '5,100'],
    ],
    'Amoxicillin 250mg Capsules': [
      ['Amoxicillin trihydrate', 'RAW_MATERIAL', '120 kg', '120 kg'],
      ['Gelatin capsules size 2', 'PACKAGING', '600,000', '598,000'],
      ['Leaflet', 'PACKAGING', '6,000', '6,000'],
    ],
    'ORS Sachets': [
      ['Dextrose anhydrous', 'RAW_MATERIAL', '400 kg', '400 kg'],
      ['Sachet laminate', 'PACKAGING', '20,000', '20,300'],
    ],
  } as Parameters<typeof components>[1];
  const TPE = { creator: 'sara', mkt: 'rohan', approver: 'priya', heads: ['vikram'] };
  const THC = { creator: 'rahul', mkt: 'nisha', approver: 'arjun', heads: ['meera'] };

  const made: O[] = [];

  // 1. Phase 1: CBM sent back once, the revision waits for Marketing
  {
    const o = await order(
      'cbm',
      'tpe',
      'alnoor',
      '2 products for the Dubai tender; 40ft containers',
      4,
    );
    await o.step(0.5, 'sara', 'cbm', {
      action: 'SUBMIT',
      uploads: [await file('sara', 'CBM', 'CBM_v1.pdf')],
    });
    await o.step(1, 'rohan', 'cbm', { action: 'RETURN', comment: 'Pallet height over the limit' });
    await o.step(1.5, 'sara', 'cbm', {
      action: 'SUBMIT',
      uploads: [await file('sara', 'CBM', 'CBM_v2.pdf')],
      comment: 'Lowered to 4 layers',
    });
    made.push(o);
  }
  // 2. Phase 1: PI rejected once, now with the Head Approver
  {
    const o = await order('pi', 'tpe', 'kenya', 'Repeat order, same products as March', 9);
    await phase1(o, TPE, ['Paracetamol 500mg Tablets', 'ORS Sachets'], {
      rejectPi: true,
      stop: 'head',
    });
    made.push(o);
  }
  // 3. Phase 1: waiting for Accounts to see the advance
  {
    const o = await order('advance', 'thc', 'medline', 'Capsules only', 10);
    await phase1(o, THC, ['Amoxicillin 250mg Capsules'], { stop: 'advance' });
    made.push(o);
  }
  // 4. Phase 2: review loops in progress
  {
    const o = await order('loops', 'tpe', 'andes', 'Two products; Spanish artwork', 21);
    await phase1(o, TPE, ['Paracetamol 500mg Tablets', 'Amoxicillin 250mg Capsules']);
    await phase2(o, ROWS, 'loops');
    made.push(o);
  }
  // 5. Phase 2: one component still to arrive
  {
    const o = await order('delivery', 'thc', 'kenya', 'ORS for the rainy season', 30);
    await phase1(o, THC, ['ORS Sachets', 'Paracetamol 500mg Tablets']);
    await phase2(o, ROWS, 'delivery');
    made.push(o);
  }
  // 6. Phase 2: Production QA sent cartons back to Materials
  {
    const o = await order('qa', 'tpe', 'medline', 'Tablets, urgent', 34);
    await phase1(o, TPE, ['Paracetamol 500mg Tablets']);
    await phase2(o, ROWS, 'qa');
    made.push(o);
  }
  // 7. Phase 3: payment check restarted after a short payment
  {
    const o = await order('payment', 'tpe', 'alnoor', 'Capsules and tablets', 45);
    await phase1(o, TPE, ['Amoxicillin 250mg Capsules', 'Paracetamol 500mg Tablets']);
    await phase2(o, ROWS, 'end');
    await o.step(1, 'imran', 'container', {
      action: 'SUBMIT',
      comment: '1 × 40ft HC, 18 pallets, 21.4 t',
    });
    await o.step(1, 'rohan', 'container', { action: 'CONFIRM' });
    await o.step(1, 'imran', 'invoice', {
      action: 'SUBMIT',
      uploads: [await file('imran', 'INVOICE', 'Commercial_Invoice.pdf')],
    });
    await o.step(1, 'rohan', 'invoice', {
      action: 'RETURN',
      comment: 'HS code for capsules is 3004.10',
    });
    await o.step(1, 'imran', 'invoice', {
      action: 'SUBMIT',
      uploads: [await file('imran', 'INVOICE', 'Commercial_Invoice_v2.pdf')],
    });
    await o.step(0.5, 'rohan', 'invoice', { action: 'CONFIRM' });
    await o.step(0.5, 'rohan', 'balance_requested', { action: 'LOG' });
    await o.step(3, 'pooja', 'payment_check', { action: 'APPROVE', payment: payment('68000') });
    await o.step(0.5, 'rohan', 'payment_check', { action: 'APPROVE' });
    await o.step(1, 'arjun', 'payment_check', {
      action: 'REJECT',
      comment: 'Short by USD 2,000 after bank charges',
    });
    await o.step(2, 'pooja', 'payment_check', { action: 'APPROVE', payment: payment('2000') });
    await o.step(0.5, 'rohan', 'payment_check', { action: 'APPROVE' });
    made.push(o);
  }
  // 8. Phase 3: at sea; the buyer asked for the BoL, now with the Head Approvers
  {
    const o = await order('bol', 'thc', 'andes', 'ORS sachets', 60);
    await phase1(o, THC, ['ORS Sachets']);
    await phase2(o, ROWS, 'end');
    await o.step(1, 'tara', 'container', { action: 'SUBMIT', comment: '1 × 20ft, 9 pallets' });
    await o.step(1, 'nisha', 'container', { action: 'CONFIRM' });
    await o.step(1, 'tara', 'invoice', {
      action: 'SUBMIT',
      uploads: [await file('tara', 'INVOICE', 'Commercial_Invoice.pdf')],
    });
    await o.step(1, 'nisha', 'invoice', { action: 'CONFIRM' });
    await o.step(0.5, 'nisha', 'balance_requested', { action: 'LOG' });
    await o.step(2, 'pooja', 'payment_check', { action: 'APPROVE', payment: payment('41000') });
    await o.step(0.5, 'nisha', 'payment_check', { action: 'APPROVE' });
    await o.step(0.5, 'priya', 'payment_check', { action: 'APPROVE' });
    await o.step(0.5, 'meera', 'payment_check', { action: 'APPROVE' });
    await o.step(1, 'tara', 'sailed', { action: 'LOG', comment: 'Sailed from Nhava Sheva' });
    await o.step(3, 'tara', 'tracking', {
      action: 'CHECKPOINT',
      shipmentStatus: 'IN_TRANSIT',
      comment: 'Transshipment at Colombo',
    });
    await o.step(4, 'imran', 'tracking', {
      action: 'CHECKPOINT',
      shipmentStatus: 'DELAYED',
      comment: 'Congestion at Panama, about 3 days',
    });
    await o.step(2, 'imran', 'bol_requested', {
      action: 'LOG',
      comment: 'Buyer emailed for the BoL',
    });
    await o.step(0.5, 'imran', 'bol', {
      action: 'COMPLETE',
      uploads: [await file('imran', 'BOL', 'Bill_of_Lading.pdf')],
    });
    await o.step(0.5, 'tara', 'bol_approval', { action: 'APPROVE' });
    await o.step(0.5, 'nisha', 'bol_approval', { action: 'APPROVE' });
    await o.step(0.5, 'arjun', 'bol_approval', { action: 'APPROVE' });
    made.push(o);
  }
  // 9. No Action Needed: BoL sent, still at sea
  // 10. Done
  for (const [key, buyerKey, startDays, close] of [
    ['sent', 'kenya', 75, false],
    ['done', 'medline', 95, true],
  ] as const) {
    const o = await order(key, 'tpe', buyerKey, 'Tablets', startDays);
    await phase1(o, TPE, ['Paracetamol 500mg Tablets']);
    await phase2(o, ROWS, 'end');
    await o.step(1, 'imran', 'container', { action: 'SUBMIT', comment: '1 × 40ft' });
    await o.step(1, 'rohan', 'container', { action: 'CONFIRM' });
    await o.step(1, 'imran', 'invoice', {
      action: 'SUBMIT',
      uploads: [await file('imran', 'INVOICE', 'Commercial_Invoice.pdf')],
    });
    await o.step(1, 'rohan', 'invoice', { action: 'CONFIRM' });
    await o.step(0.5, 'rohan', 'balance_requested', { action: 'LOG' });
    await o.step(2, 'pooja', 'payment_check', { action: 'APPROVE', payment: payment('52000') });
    await o.step(0.5, 'rohan', 'payment_check', { action: 'APPROVE' });
    await o.step(0.5, 'arjun', 'payment_check', { action: 'APPROVE' });
    await o.step(0.5, 'meera', 'payment_check', { action: 'APPROVE' });
    await o.step(1, 'imran', 'sailed', { action: 'LOG' });
    await o.step(5, 'imran', 'tracking', {
      action: 'CHECKPOINT',
      shipmentStatus: 'IN_TRANSIT',
      comment: 'On schedule',
    });
    await o.step(4, 'imran', 'bol_requested', { action: 'LOG' });
    await o.step(0.5, 'imran', 'bol', {
      action: 'COMPLETE',
      uploads: [await file('imran', 'BOL', 'Bill_of_Lading.pdf')],
    });
    for (const who of ['pooja', 'rohan', 'priya', 'vikram', 'meera'])
      await o.step(0.5, who, 'bol_approval', { action: 'APPROVE' });
    await o.step(0.5, 'imran', 'bol_sent', { action: 'LOG', comment: 'Couriered original BoL' });
    await o.step(3, 'imran', 'tracking', {
      action: 'CHECKPOINT',
      shipmentStatus: 'AT_PORT',
      comment: 'Arrived at destination port',
    });
    if (close) {
      await o.step(2, 'imran', 'tracking', {
        action: 'CHECKPOINT',
        shipmentStatus: 'CUSTOMS',
        comment: 'Cleared customs',
      });
      await o.step(2, 'imran', 'delivered', {
        action: 'CLOSE',
        comment: 'Buyer confirmed receipt',
      });
    }
    made.push(o);
  }

  for (const o of made) await spreadOverDays(db, o.id, o.marks, o.startDaysAgo);
  return { employees: Object.keys(users).length, companies: COMPANIES.length, orders: made.length };
}

/**
 * The engine stamps everything with the real clock, so a seeded order would look as if it
 * all happened in a second. This maps each order's real timestamps onto virtual days: every
 * action's moment becomes (start + its virtual day), keeping the exact order of events.
 * Demo only: it briefly lifts the append-only rule on order_events inside the transaction.
 */
async function spreadOverDays(
  db: Db,
  orderId: string,
  marks: Array<{ real: Date; day: number }>,
  startDaysAgo: number,
) {
  const now = Date.now();
  const span = Math.max(1, marks.at(-1)!.day);
  // Fit the order into the time since it "started", leaving the last action a little in the past
  const scale = Math.min(1, (startDaysAgo - 0.3) / span);
  const start = now - startDaysAgo * DAY;
  const points = marks.map((m) => ({
    real: m.real.toISOString(),
    virtual: new Date(start + m.day * scale * DAY).toISOString(),
  }));
  const values = sql.join(
    points.map((p) => sql`(${p.real}::timestamptz, ${p.virtual}::timestamptz)`),
    sql`, `,
  );
  const map = (col: string) =>
    `(select v.virtual + (${col} - v.real) from seed_marks v where v.real <= ${col} order by v.real desc limit 1)`;
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`create temporary table seed_marks (real timestamptz, virtual timestamptz) on commit drop`,
    );
    await tx.execute(sql`insert into seed_marks values ${values}`);
    await tx.execute(
      sql`alter table order_events disable trigger order_events_no_update_or_delete`,
    );
    const tables: Array<[string, string[], string]> = [
      [
        'orders',
        ['created_at', 'updated_at', 'chain_started_at', 'production_started_at', 'closed_at'],
        'id',
      ],
      ['tasks', ['opened_at', 'done_at', 'updated_at'], 'order_id'],
      ['holder_intervals', ['started_at', 'ended_at'], 'order_id'],
      ['channel_rounds', ['submitted_at', 'verdict_at'], 'order_id'],
      ['documents', ['uploaded_at'], 'order_id'],
      ['payments', ['verified_at'], 'order_id'],
      ['order_components', ['created_at', 'updated_at'], 'order_id'],
      ['component_changes', ['created_at'], 'order_id'],
      ['shipment_checkpoints', ['logged_at'], 'order_id'],
      ['order_events', ['created_at'], 'order_id'],
    ];
    for (const [table, cols, key] of tables) {
      // Table and column names are constants above; the order id is bound as a parameter
      const set = cols
        .map((c) => `${c} = case when ${c} is null then null else ${map(c)} end`)
        .join(', ');
      await tx.execute(
        sql`update ${sql.identifier(table)} set ${sql.raw(set)} where ${sql.identifier(key)} = ${orderId}`,
      );
    }
    await tx.execute(sql`
      update approval_votes v set created_at = (select m.virtual + (v.created_at - m.real) from seed_marks m where m.real <= v.created_at order by m.real desc limit 1)
       where v.task_id in (select id from tasks where order_id = ${orderId})`);
    // Shipment dates and payment dates follow their own (now virtual) log times
    await tx.execute(
      sql`update shipment_checkpoints set happened_on = (logged_at at time zone 'Asia/Kolkata')::date where order_id = ${orderId}`,
    );
    await tx.execute(
      sql`update payments set received_on = (verified_at at time zone 'Asia/Kolkata')::date where order_id = ${orderId}`,
    );
    await tx.execute(sql`alter table order_events enable trigger order_events_no_update_or_delete`);
  });
}
