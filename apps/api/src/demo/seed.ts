import { randomUUID } from 'node:crypto';
import type { Capability, DocKind, Slot, TaskActionRequest, Team } from '@docflow/shared';
import { TaskActionRequest as ActionSchema, ComponentInput, OrderCreate } from '@docflow/shared';
import { count, sql } from 'drizzle-orm';
import type { AuthUser } from '../auth/sessions.js';
import { hashPassword } from '../auth/crypto.js';
import type { Db } from '../db/client.js';
import {
  buyers,
  buyerSlotGates,
  buyerSlotPeople,
  employeeCapabilities,
  employees,
  orders,
  tasks,
  teamMembers,
  uploads,
} from '../db/schema.js';
import { addComponent, updateComponent, uploadComponentPo } from '../engine/components.js';
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

type Chain = Array<[Slot, string[], ('ALL' | 'ANY')?]>;

const TPE_CHAIN: Chain = [
  ['MARKETING', ['rohan']],
  ['CREATOR', ['sara']],
  ['PI_APPROVER', ['priya']],
  ['PI_HEAD', ['vikram'], 'ALL'],
  ['PAY_APPROVER', ['arjun']],
  ['PAY_HEAD', ['vikram', 'meera'], 'ANY'],
  ['BOL_APPROVER', ['priya']],
  ['BOL_HEAD', ['vikram', 'meera'], 'ALL'],
];
const THC_CHAIN: Chain = [
  ['MARKETING', ['nisha']],
  ['CREATOR', ['rahul']],
  ['PI_APPROVER', ['arjun']],
  ['PI_HEAD', ['meera'], 'ALL'],
  ['PAY_APPROVER', ['priya']],
  ['PAY_HEAD', ['meera'], 'ALL'],
  ['BOL_APPROVER', ['arjun']],
  ['BOL_HEAD', ['vikram', 'meera'], 'ANY'],
];

/** The buyer is the company the order is for, with its own default chain (D27) */
const BUYERS: Array<{
  key: string;
  name: string;
  code: string;
  country: string;
  address: string;
  /** Prefix of the PI numbers the Creator gives this buyer's orders */
  pi: string;
  chain: Chain;
}> = [
  {
    key: 'alnoor',
    name: 'Al Noor Medical',
    code: 'ANM',
    country: 'United Arab Emirates',
    address: 'Al Quoz Industrial 3, Dubai',
    pi: 'TPE/PI/26-27',
    chain: TPE_CHAIN,
  },
  {
    key: 'kenya',
    name: 'Kenya Health Supplies',
    code: 'KHS',
    country: 'Kenya',
    address: 'Mombasa Road, Nairobi',
    pi: 'TPE/PI/26-27',
    chain: TPE_CHAIN,
  },
  {
    key: 'andes',
    name: 'Andes Pharma',
    code: 'AND',
    country: 'Peru',
    address: 'Av. Javier Prado 1450, Lima',
    pi: 'TPE/PI/26-27',
    chain: TPE_CHAIN,
  },
  {
    key: 'medline',
    name: 'MedLine Philippines',
    code: 'MLP',
    country: 'Philippines',
    address: 'Ortigas Center, Pasig City',
    pi: 'THC/PI/26-27',
    chain: THC_CHAIN,
  },
  {
    key: 'gulf',
    name: 'Gulf Care Trading',
    code: 'GCT',
    country: 'Oman',
    address: 'Ruwi High Street, Muscat',
    pi: 'THC/PI/26-27',
    chain: THC_CHAIN,
  },
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
  {
    password = DEMO_PASSWORD,
    withAdmin = true,
    mode = 'full',
    preferred = {},
  }: {
    password?: string;
    withAdmin?: boolean;
    /**
     * full: everything, into an empty database. add-private: only the orders full of private
     * messages (D31), added next to existing data, using the people and buyers already there.
     */
    mode?: 'full' | 'add-private';
    /** add-private: who to act as per team, by first name (others: anyone in the team) */
    preferred?: PreferredPeople;
  } = {},
) {
  if (mode === 'add-private') return addPrivateOrders(db, storage, preferred);
  const [{ others } = { others: 0 }] = await db
    .select({ others: count() })
    .from(employees)
    .where(
      withAdmin
        ? undefined
        : sql`not exists (select 1 from ${employeeCapabilities} c where c.employee_id = ${employees.id} and c.capability = 'ADMIN')`,
    );
  const [{ n: orderCount } = { n: 0 }] = await db.select({ n: count() }).from(orders);
  const [{ n: buyerCount } = { n: 0 }] = await db.select({ n: count() }).from(buyers);
  if (others + orderCount + buyerCount > 0) {
    throw new Error(
      withAdmin
        ? 'seed:demo only runs on an empty database (it found existing data)'
        : 'seed:demo --live only runs right after reset:data (it found existing data)',
    );
  }

  const passwordHash = await hashPassword(password);
  const users: Record<string, AuthUser> = {};
  const buyerIds: Record<string, string> = {};
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

  for (const b of BUYERS) {
    const [row] = await db
      .insert(buyers)
      .values({ name: b.name, code: b.code, country: b.country, address: b.address })
      .returning({ id: buyers.id });
    buyerIds[b.key] = row!.id;
    for (const [slot, keys, gate] of b.chain) {
      await db
        .insert(buyerSlotPeople)
        .values(
          keys.map((k, ordinal) => ({ buyerId: row!.id, slot, employeeId: users[k]!.id, ordinal })),
        );
      if (gate) await db.insert(buyerSlotGates).values({ buyerId: row!.id, slot, gate });
    }
  }
  return runScenarios(db, storage, users, buyerIds, 'full');
}

/** Loads a person as the engine sees them: teams and capabilities from the database */
async function loadUser(db: Db, id: string): Promise<AuthUser> {
  const { rows } = await db.execute<{
    name: string;
    email: string;
    teams: Team[];
    capabilities: Capability[];
  }>(sql`
    select e.name, e.email,
           array(select team::text from team_members t where t.employee_id = e.id) as teams,
           array(select capability::text from employee_capabilities c where c.employee_id = e.id) as capabilities
      from employees e where e.id = ${id} and e.is_active`);
  const r = rows[0];
  if (!r) throw new Error(`demo: employee ${id} is missing or inactive`);
  return {
    id,
    sessionId: 'seed',
    name: r.name,
    email: r.email,
    employeeCode: null,
    teams: r.teams,
    capabilities: r.capabilities,
  };
}

/** The team each demo role acts as in the private-message orders (D31) */
const TEAM_PEOPLE: Array<[string, Team]> = [
  ['kabir', 'MATERIALS'],
  ['neha', 'MATERIALS'],
  ['lina', 'REGULATION'],
  ['dev', 'REGULATION'],
  ['ananya', 'DESIGN'],
  ['farhan', 'PRODUCTION'],
  ['pooja', 'ACCOUNTS'],
  ['imran', 'LOGISTICS'],
  ['tara', 'LOGISTICS'],
];

/** Who to act as, per team, on the live site: a first name to look for (D31) */
export type PreferredPeople = Partial<Record<Team, string>>;

/**
 * Adds only the private-message orders (D31) to a database that already has data, e.g. the
 * live site: the demo team members and buyers must exist; the chains are whatever the buyers
 * have now. Checks everything before writing anything.
 */
async function addPrivateOrders(db: Db, storage: StorageService, preferred: PreferredPeople) {
  const users: Record<string, AuthUser> = {};
  const problems: string[] = [];
  for (const [key, team] of TEAM_PEOPLE) {
    // The person asked for by first name, else the demo account, else anyone in the team
    const { rows } = await db.execute<{ id: string }>(sql`
      select e.id from employees e join team_members m on m.employee_id = e.id
       where e.is_active and m.team = ${team}
       order by (lower(e.name) like ${`${(preferred[team] ?? '').toLowerCase()}%`} and ${!!preferred[team]}) desc,
                (lower(e.email) = ${demoEmail(key)}) desc,
                lower(e.name)
       limit 1`);
    if (!rows[0]) {
      problems.push(`nobody active is in ${team}`);
      continue;
    }
    users[key] = await loadUser(db, rows[0].id);
  }
  const buyerIds: Record<string, string> = {};
  for (const b of BUYERS) {
    const { rows } = await db.execute<{ id: string }>(
      sql`select id from buyers where (code = ${b.code} or lower(name) = lower(${b.name})) and is_active limit 1`,
    );
    if (rows[0]) buyerIds[b.key] = rows[0].id;
    else problems.push(`buyer ${b.name} (${b.code}) is missing or inactive`);
  }
  if (problems.length) {
    throw new Error(`Nothing was added. Fix these first:\n- ${problems.join('\n- ')}`);
  }
  console.log(
    `Acting as: ${[...new Set(TEAM_PEOPLE.map(([k, t]) => `${users[k]!.name} (${t})`))].join(', ')}`,
  );
  return runScenarios(db, storage, users, buyerIds, 'add-private');
}

/** Drives the engine through every demo order, as people would, then spreads it over days */
async function runScenarios(
  db: Db,
  storage: StorageService,
  users: Record<string, AuthUser>,
  buyerIds: Record<string, string>,
  mode: 'full' | 'add-private',
) {
  // Live PI numbers continue well past the first demo's
  let piNumber = mode === 'full' ? 40 : 100;
  /** A named person on an order, loaded on first use (the live chains can be anyone) */
  const person = async (id: string) => {
    users[id] ??= await loadUser(db, id);
    return id;
  };

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
  async function order(key: string, buyerKey: string, notes: string, startDaysAgo: number) {
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
    const buyer = BUYERS.find((b) => b.key === buyerKey)!;
    // Whoever the buyer's chain names as Marketing creates it (the live chains can differ)
    const { rows: mkt } = await db.execute<{ id: string }>(sql`
      select employee_id as id from buyer_slot_people
       where buyer_id = ${buyerIds[buyerKey]} and slot = 'MARKETING' order by ordinal limit 1`);
    const id = await createOrder(
      db,
      users[await person(mkt[0]!.id)]!,
      OrderCreate.parse({ buyerId: buyerIds[buyerKey], notes }),
    );
    /** The people on this order's slot, as keys of `users` */
    const slot = async (name: string) => {
      const { rows } = await db.execute<{ id: string }>(sql`
        select employee_id as id from order_slot_people
         where order_id = ${id} and slot = ${name} order by ordinal`);
      return Promise.all(rows.map((r) => person(r.id)));
    };
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
      slot,
      /** Who acts in Phase 1 here: this order's own chain */
      chain: async () => ({
        creator: (await slot('CREATOR'))[0]!,
        mkt: (await slot('MARKETING'))[0]!,
        approver: (await slot('PI_APPROVER'))[0]!,
        heads: await slot('PI_HEAD'),
      }),
      piRef: () => `${buyer.pi}/${String(++piNumber).padStart(4, '0')}`,
      products: async () => {
        const rows = await db.execute<{ id: string; name: string }>(
          sql`select id, name from order_products where order_id = ${id} order by position`,
        );
        return rows.rows;
      },
    };
  }
  type O = Awaited<ReturnType<typeof order>>;

  const payment = (amount: string, currency = 'INR') => ({
    receivedOn: daysAgo(0),
    amount,
    currency,
    reference: `TT-${amount.slice(0, 4)}`,
  });

  async function phase1(
    o: O,
    who: { creator: string; mkt: string; approver: string; heads: string[]; approvers?: string[] },
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
    // The Creator renames the order to the PI's number (D27)
    await o.step(1, who.creator, 'pi', {
      action: 'COMPLETE',
      products,
      orderRef: o.piRef(),
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
    // Everyone the stage needs (ALL), or the first (ANY): the live chains can be either
    await approveStage(o, 'pi_approval', 'approver', who.approvers ?? [who.approver], 1);
    if (opts.stop === 'head') return;
    await approveStage(o, 'pi_approval', 'head', who.heads);
    await o.step(0.5, who.mkt, 'advance_requested', { action: 'LOG' });
    if (opts.stop === 'advance') return;
    await o.step(2, 'pooja', 'advance_verified', {
      action: 'COMPLETE',
      payment: payment('2500000'),
    });
  }

  type Row = [string, 'RAW_MATERIAL' | 'PACKAGING', string, string];
  type Rows = Record<string, Row[]>;

  /**
   * Materials' component tables, the way the team works (D27): every component listed as soon
   * as production starts, the PO Date when it is ordered, then dispatch and delivery with the
   * Challan No. and LR Details. Each date gets its own day on the timeline.
   */
  function tables(o: O, rows: Rows) {
    const parts = new Map<string, { id: string; input: Record<string, string | null> }>();
    const of = (p: { name: string }, kind: Row[1]) =>
      (rows[p.name] ?? []).filter((r) => r[1] === kind);
    const save = async (key: string, patch: Record<string, string | null>) => {
      const part = parts.get(key)!;
      part.input = { ...part.input, ...patch };
      await updateComponent(db, users.kabir!, part.id, ComponentInput.parse(part.input));
    };
    return {
      async list(p: { id: string; name: string }) {
        for (const [name, kind, po] of rows[p.name] ?? []) {
          await o.mark(0.1);
          const input = { name, kind, poQuantity: po };
          const id = await addComponent(db, users.kabir!, o.id, p.id, ComponentInput.parse(input));
          parts.set(`${p.name}|${name}`, { id, input });
        }
      },
      async ordered(p: { name: string }, kind: Row[1]) {
        for (const [name] of of(p, kind)) {
          await o.mark(0.2);
          // Each component's purchase order, then its PO Date (D29)
          const po = await file('kabir', 'PO', `PO_${name.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`);
          await uploadComponentPo(
            db,
            storage,
            users.kabir!,
            parts.get(`${p.name}|${name}`)!.id,
            po.uploadId,
          );
          await save(`${p.name}|${name}`, { poDate: daysAgo(0) });
        }
      },
      /** Dispatched, then delivered; `deliver: false` stops a component at Dispatched */
      async arrived(p: { name: string }, deliver: (name: string) => boolean) {
        for (const [name, , po, made] of rows[p.name] ?? []) {
          await o.mark(0.6);
          await save(`${p.name}|${name}`, {
            dispatchDate: daysAgo(0),
            lrDetails: `LR-${Math.floor(10000 + Math.random() * 89999)}`,
            challanNo: `CH-${Math.floor(1000 + Math.random() * 8999)}`,
          });
          if (!deliver(name)) continue;
          await o.mark(1.2);
          await save(`${p.name}|${name}`, {
            deliverDate: daysAgo(0),
            orderQuantity: made,
            tnsRemark: made !== po ? 'Run within ±2%' : null,
          });
        }
      },
    };
  }

  async function phase2(o: O, rows: Rows, stopAt: 'loops' | 'delivery' | 'qa' | 'end') {
    const products = await o.products();
    const t = tables(o, rows);
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
    // Every component listed up front, even before anything is ordered (D27)
    for (const p of products) await t.list(p);
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
    await t.ordered(first!, 'RAW_MATERIAL');
    await o.step(
      0.2,
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
      // Ordered a few days late, so the ordering delay shows
      await o.mark(2);
      await t.ordered(p, 'RAW_MATERIAL');
      await o.step(0.2, 'kabir', 'raw_material', { action: 'COMPLETE' }, p.name);
    }
    for (const p of products) {
      await o.mark(1);
      await t.ordered(p, 'PACKAGING');
      await o.step(
        0.2,
        'kabir',
        'packaging',
        { action: 'COMPLETE', comment: 'Printing started' },
        p.name,
      );
    }
    // The last component of the last product is still on the way when stopping at delivery
    const last = products.at(-1)!;
    const lastPart = (rows[last.name] ?? []).at(-1)?.[0];
    for (const p of products) {
      await o.mark(3);
      await t.arrived(p, (name) => stopAt !== 'delivery' || p !== last || name !== lastPart);
    }
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
    await o.step(1, 'farhan', 'production_qa', { action: 'CONFIRM', comment: 'Materials fine' });
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
  } as Rows;
  const TPE = { creator: 'sara', mkt: 'rohan', approver: 'priya', heads: ['vikram'] };
  const THC = { creator: 'rahul', mkt: 'nisha', approver: 'arjun', heads: ['meera'] };

  const made: O[] = [];
  if (mode === 'full') {
    // 1. Phase 1: CBM sent back once, the revision waits for Marketing
    {
      const o = await order('cbm', 'alnoor', '2 products for the Dubai tender; 40ft containers', 4);
      await o.step(0.5, 'sara', 'cbm', {
        action: 'SUBMIT',
        uploads: [await file('sara', 'CBM', 'CBM_v1.pdf')],
      });
      await o.step(1, 'rohan', 'cbm', {
        action: 'RETURN',
        comment: 'Pallet height over the limit',
      });
      await o.step(1.5, 'sara', 'cbm', {
        action: 'SUBMIT',
        uploads: [await file('sara', 'CBM', 'CBM_v2.pdf')],
        comment: 'Lowered to 4 layers',
      });
      made.push(o);
    }
    // 2. Phase 1: PI rejected once, now with the Head Approver
    {
      const o = await order('pi', 'kenya', 'Repeat order, same products as March', 9);
      await phase1(o, TPE, ['Paracetamol 500mg Tablets', 'ORS Sachets'], {
        rejectPi: true,
        stop: 'head',
      });
      made.push(o);
    }
    // 3. Phase 1: waiting for Accounts to see the advance
    {
      const o = await order('advance', 'medline', 'Capsules only', 10);
      await phase1(o, THC, ['Amoxicillin 250mg Capsules'], { stop: 'advance' });
      made.push(o);
    }
    // 4. Phase 2: review loops in progress
    {
      const o = await order('loops', 'andes', 'Two products; Spanish artwork', 21);
      await phase1(o, TPE, ['Paracetamol 500mg Tablets', 'Amoxicillin 250mg Capsules']);
      await phase2(o, ROWS, 'loops');
      made.push(o);
    }
    // 5. Phase 2: one component still to arrive
    {
      const o = await order('delivery', 'medline', 'ORS for the rainy season', 30);
      await phase1(o, THC, ['ORS Sachets', 'Paracetamol 500mg Tablets']);
      await phase2(o, ROWS, 'delivery');
      made.push(o);
    }
    // 6. Phase 2: Production QA sent cartons back to Materials
    {
      const o = await order('qa', 'kenya', 'Tablets, urgent', 34);
      await phase1(o, TPE, ['Paracetamol 500mg Tablets']);
      await phase2(o, ROWS, 'qa');
      made.push(o);
    }
    // 7. Phase 3: payment check restarted after a short payment
    {
      const o = await order('payment', 'alnoor', 'Capsules and tablets', 45);
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
      await o.step(3, 'pooja', 'payment_check', { action: 'APPROVE', payment: payment('5600000') });
      await o.step(0.5, 'rohan', 'payment_check', { action: 'APPROVE' });
      await o.step(1, 'arjun', 'payment_check', {
        action: 'REJECT',
        comment: 'Short by INR 1,60,000 after bank charges',
      });
      await o.step(2, 'pooja', 'payment_check', { action: 'APPROVE', payment: payment('160000') });
      await o.step(0.5, 'rohan', 'payment_check', { action: 'APPROVE' });
      made.push(o);
    }
    // 8. Phase 3: at sea; the buyer asked for the BoL, now with the Head Approvers
    {
      const o = await order('bol', 'gulf', 'ORS sachets', 60);
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
      await o.step(2, 'pooja', 'payment_check', { action: 'APPROVE', payment: payment('3400000') });
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
      ['done', 'andes', 95, true],
    ] as const) {
      const o = await order(key, buyerKey, 'Tablets', startDays);
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
      await o.step(2, 'pooja', 'payment_check', { action: 'APPROVE', payment: payment('4300000') });
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
  }

  // ---- Orders full of private messages (D31), at different stages ------------------------

  /** Everyone on a stage approves, stopping as soon as the stage moves on (an ANY gate) */
  async function approveStage(o: O, stepKey: string, stage: string, ids: string[], after = 0.5) {
    for (const id of ids) {
      const { rows } = await db.execute<{ status: string; side: string | null }>(
        sql`select status::text, side from ${tasks} where order_id = ${o.id} and step_key = ${stepKey}`,
      );
      if (rows[0]?.status !== 'OPEN' || rows[0].side !== stage) return;
      await o.step(after, id, stepKey, { action: 'APPROVE' });
    }
  }
  /** Shared with these people and teams (approvers and Head Approvers always see it) */
  const priv = (people: string[], teams: Team[] = []) => ({
    employeeIds: people.map((k) => users[k]!.id),
    teams,
  });

  // A. Phase 1, CBM: Marketing sends it back privately to Accounts; the Creator answers privately
  {
    const o = await order('priv-cbm', 'alnoor', 'Margin-sensitive tender, 2 products', 3);
    const c = await o.chain();
    await o.step(0.3, c.creator, 'cbm', {
      action: 'SUBMIT',
      uploads: [await file(c.creator, 'CBM', 'CBM_v1.pdf')],
      comment: 'First draft, 18 pallets',
    });
    await o.step(1, c.mkt, 'cbm', {
      action: 'RETURN',
      comment:
        'The buyer’s target price leaves no room for a 40ft HC. Accounts, please check the margin before we resend.',
      privateTo: priv([], ['ACCOUNTS']),
    });
    await o.step(1, c.creator, 'cbm', {
      action: 'SUBMIT',
      uploads: [await file(c.creator, 'CBM', 'CBM_v2.pdf')],
      comment: 'Re-planned to 16 pallets. Margin is 4.2%, for Marketing only.',
      privateTo: priv([c.mkt]),
    });
    made.push(o);
  }

  // B. Phase 1, PI approval: a private rejection to Logistics, a private rework, now with the Head
  {
    const o = await order('priv-pi', 'kenya', 'Repeat order, CIF Mombasa', 8);
    const c = await o.chain();
    await o.step(0.3, c.creator, 'cbm', {
      action: 'SUBMIT',
      uploads: [await file(c.creator, 'CBM', 'CBM_v1.pdf')],
    });
    await o.step(0.5, c.mkt, 'cbm', { action: 'CONFIRM' });
    await o.step(1, c.mkt, 'cbm_buyer_confirmed', { action: 'LOG' });
    await o.step(1, c.creator, 'pi', {
      action: 'COMPLETE',
      products: ['Paracetamol 500mg Tablets'],
      orderRef: o.piRef(),
      uploads: [
        await file(c.creator, 'PI_FULL', 'PI_full.pdf'),
        await file(c.creator, 'PI_NO_RATES', 'PI_quantities_only.pdf'),
      ],
    });
    await o.step(0.5, c.mkt, 'pi_approval', { action: 'APPROVE' });
    await o.step(1, c.approver, 'pi_approval', {
      action: 'REJECT',
      comment:
        'Freight for CIF Mombasa is under-quoted. Logistics, please re-quote before this goes out.',
      privateTo: priv([], ['LOGISTICS']),
    });
    await o.step(1, c.creator, 'pi', {
      action: 'COMPLETE',
      products: ['Paracetamol 500mg Tablets'],
      uploads: [await file(c.creator, 'PI_FULL', 'PI_full_v2.pdf')],
      comment: 'Freight revised with Logistics’ new quote',
      privateTo: priv([c.mkt], ['LOGISTICS']),
    });
    await o.step(0.5, c.mkt, 'pi_approval', { action: 'APPROVE' });
    await o.step(1, c.approver, 'pi_approval', {
      action: 'APPROVE',
      comment: 'Fine at the revised freight',
      privateTo: priv([c.mkt]),
    });
    made.push(o);
  }

  // C. Phase 2, review loops: private returns to Marketing and Design, a private resubmit
  {
    const o = await order('priv-loops', 'medline', 'ORS, new artwork for the regulator', 22);
    const c = await o.chain();
    await phase1(o, { ...c, approvers: await o.slot('PI_APPROVER') }, ['ORS Sachets']);
    const product = 'ORS Sachets';
    await o.step(
      0.5,
      'kabir',
      'annexure',
      { action: 'SUBMIT', uploads: [await file('kabir', 'ANNEXURE', 'Annexure_ORS.pdf')] },
      product,
    );
    await o.step(
      0.5,
      'ananya',
      'artwork',
      { action: 'SUBMIT', uploads: [await file('ananya', 'ARTWORK', 'Artwork_ORS.pdf')] },
      product,
    );
    await o.step(
      1.5,
      'lina',
      'annexure',
      {
        action: 'RETURN',
        comment:
          'The regulator flagged the batch code font size. Design, please align the artwork too.',
        privateTo: priv([c.mkt], ['DESIGN']),
      },
      product,
    );
    await o.step(
      1,
      'kabir',
      'annexure',
      {
        action: 'SUBMIT',
        uploads: [await file('kabir', 'ANNEXURE', 'Annexure_ORS_v2.pdf')],
        comment: 'Bigger batch code. Production, check the coding machine can print this size.',
        privateTo: priv([], ['PRODUCTION']),
      },
      product,
    );
    await o.step(
      1,
      'dev',
      'artwork',
      {
        action: 'RETURN',
        comment: 'The artwork still shows the old licence number.',
        privateTo: priv([c.mkt]),
      },
      product,
    );
    made.push(o);
  }

  // D. Phase 3, payment check: a private invoice return and resubmit, a private payment note
  {
    const o = await order('priv-payment', 'gulf', 'ORS for Muscat, short payment expected', 45);
    const c = await o.chain();
    await phase1(o, { ...c, approvers: await o.slot('PI_APPROVER') }, ['ORS Sachets']);
    await phase2(o, ROWS, 'end');
    await o.step(1, 'tara', 'container', { action: 'SUBMIT', comment: '1 × 20ft, 9 pallets' });
    await o.step(1, c.mkt, 'container', { action: 'CONFIRM' });
    await o.step(1, 'tara', 'invoice', {
      action: 'SUBMIT',
      uploads: [await file('tara', 'INVOICE', 'Commercial_Invoice.pdf')],
    });
    await o.step(1, c.mkt, 'invoice', {
      action: 'RETURN',
      comment:
        'The declared value doesn’t match the PI. Accounts, please confirm the value before Logistics resends.',
      privateTo: priv([], ['ACCOUNTS']),
    });
    await o.step(1, 'tara', 'invoice', {
      action: 'SUBMIT',
      uploads: [await file('tara', 'INVOICE', 'Commercial_Invoice_v2.pdf')],
      comment: 'Corrected value, matches the PI',
      privateTo: priv([c.mkt], ['ACCOUNTS']),
    });
    await o.step(0.5, c.mkt, 'invoice', { action: 'CONFIRM' });
    await o.step(0.5, c.mkt, 'balance_requested', { action: 'LOG' });
    await o.step(2, 'pooja', 'payment_check', {
      action: 'APPROVE',
      payment: payment('3387500'),
      uploads: [await file('pooja', 'PAYMENT_PROOF', 'Bank_credit_advice.pdf')],
      comment: 'Received INR 12,500 short after bank charges. Buyer agreed to adjust next order.',
      privateTo: priv([c.mkt]),
    });
    made.push(o);
  }

  // E. Phase 3, at sea: a private delay update for Marketing only
  {
    const o = await order('priv-sea', 'andes', 'Tablets for Lima', 62);
    const c = await o.chain();
    await phase1(o, { ...c, approvers: await o.slot('PI_APPROVER') }, [
      'Paracetamol 500mg Tablets',
    ]);
    await phase2(o, ROWS, 'end');
    await o.step(1, 'imran', 'container', { action: 'SUBMIT', comment: '1 × 40ft' });
    await o.step(1, c.mkt, 'container', { action: 'CONFIRM' });
    await o.step(1, 'imran', 'invoice', {
      action: 'SUBMIT',
      uploads: [await file('imran', 'INVOICE', 'Commercial_Invoice.pdf')],
    });
    await o.step(1, c.mkt, 'invoice', { action: 'CONFIRM' });
    await o.step(0.5, c.mkt, 'balance_requested', { action: 'LOG' });
    await o.step(2, 'pooja', 'payment_check', {
      action: 'APPROVE',
      payment: payment('4300000'),
      uploads: [await file('pooja', 'PAYMENT_PROOF', 'Bank_credit_advice.pdf')],
    });
    await approveStage(o, 'payment_check', 'marketing', [c.mkt]);
    await approveStage(o, 'payment_check', 'approver', await o.slot('PAY_APPROVER'));
    await approveStage(o, 'payment_check', 'head', await o.slot('PAY_HEAD'));
    await o.step(1, 'imran', 'sailed', { action: 'LOG', comment: 'Sailed from Nhava Sheva' });
    await o.step(3, 'imran', 'tracking', {
      action: 'CHECKPOINT',
      shipmentStatus: 'IN_TRANSIT',
      comment: 'Transshipment at Colombo',
    });
    await o.step(4, 'imran', 'tracking', {
      action: 'CHECKPOINT',
      shipmentStatus: 'DELAYED',
      comment:
        'Port congestion at Callao, maybe 5 days. Let’s not tell the buyer until it’s confirmed.',
      privateTo: priv([c.mkt]),
    });
    made.push(o);
  }

  for (const o of made) await spreadOverDays(db, o.id, o.marks, o.startDaysAgo);
  return {
    employees: Object.keys(users).filter((k) => !/^[0-9a-f-]{36}$/.test(k)).length,
    buyers: BUYERS.length,
    orders: made.length,
  };
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
    // Component dates are the days Materials entered them, now virtual (D27 day counts)
    for (const [field, col] of [
      ['poDate', 'po_date'],
      ['dispatchDate', 'dispatch_date'],
      ['deliverDate', 'deliver_date'],
    ] as const) {
      await tx.execute(sql`
        update order_components c set ${sql.identifier(col)} = (
          select (ch.created_at at time zone 'Asia/Kolkata')::date from component_changes ch
           where ch.component_id = c.id and ch.field = ${field} and ch.new_value is not null
           order by ch.created_at desc limit 1)
         where c.order_id = ${orderId} and ${sql.identifier(col)} is not null`);
      await tx.execute(sql`
        update component_changes
           set new_value = to_char((created_at at time zone 'Asia/Kolkata')::date, 'YYYY-MM-DD')
         where order_id = ${orderId} and field = ${field} and new_value is not null`);
    }
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
