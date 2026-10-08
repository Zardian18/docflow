import { randomUUID } from 'node:crypto';
import type { Permission } from '@docflow/shared';
import { and, count, eq, isNotNull, sql } from 'drizzle-orm';
import { hashPassword } from '../auth/crypto.js';
import type { Db } from '../db/client.js';
import {
  companies,
  companyDefaultApprovers,
  employees,
  notificationOutbox,
  roles,
  uploads,
  workflows,
} from '../db/schema.js';
import { decide } from '../domain/decide.js';
import { submitWorkflow } from '../domain/submit.js';
import type { StorageService } from '../storage/storage.js';

/** The demo password for development and CI. The live site gets a random one (`--live`). */
export const DEMO_PASSWORD = 'demo-password-1';
export const DEMO_DOMAIN = 'demo.docflow.test';

const PEOPLE: Array<{ key: string; name: string; permission: Permission; code: string }> = [
  { key: 'admin', name: 'Anita Mehta', permission: 'ADMIN', code: 'EMP-0001' },
  { key: 'cfo', name: 'Vikram Malhotra', permission: 'CFO', code: 'EMP-0002' },
  { key: 'rahul', name: 'Rahul Mehra', permission: 'CREATOR', code: 'EMP-0101' },
  { key: 'sara', name: 'Sara Khan', permission: 'CREATOR', code: 'EMP-0102' },
  { key: 'priya', name: 'Priya Shah', permission: 'APPROVER', code: 'EMP-0201' },
  { key: 'arjun', name: 'Arjun Nair', permission: 'APPROVER', code: 'EMP-0202' },
  { key: 'meera', name: 'Meera Kulkarni', permission: 'APPROVER', code: 'EMP-0203' },
  { key: 'dev', name: 'Dev Iyer', permission: 'APPROVER', code: 'EMP-0204' },
  { key: 'lina', name: 'Lina Fernandes', permission: 'APPROVER', code: 'EMP-0205' },
];

export const demoEmail = (key: string) => `${key}@${DEMO_DOMAIN}`;

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

type Step = [who: string, decision: 'APPROVE' | 'REJECT', remarks?: string];

/**
 * Loads a realistic demo data set through the real submit and decide code, so every state is
 * one the app can actually reach: pending at each position, a part-approved parallel step,
 * waiting for the CFO, completed, rejected early (D22) and rejected by the CFO.
 *
 * By default it adds a demo Admin and needs a database with no employees. With
 * `withAdmin: false` (the live site, after `reset:data`) the existing Admins stay in charge,
 * and the only employees allowed beforehand are active Admins.
 */
export async function seedDemo(
  db: Db,
  storage: StorageService,
  { password = DEMO_PASSWORD, withAdmin = true }: { password?: string; withAdmin?: boolean } = {},
) {
  const [{ others } = { others: 0 }] = await db
    .select({ others: count() })
    .from(employees)
    .innerJoin(roles, eq(roles.id, employees.roleId))
    .where(
      withAdmin ? undefined : sql`not (${employees.isActive} and ${roles.permission} = 'ADMIN')`,
    );
  const [{ docs } = { docs: 0 }] = await db.select({ docs: count() }).from(workflows);
  const [{ firms } = { firms: 0 }] = await db.select({ firms: count() }).from(companies);
  if (others + docs + firms > 0) {
    throw new Error(
      withAdmin
        ? 'seed:demo only runs on an empty database (it found existing data)'
        : 'seed:demo --live only runs right after reset:data (it found existing data)',
    );
  }
  const takenCodes = new Set(
    (
      await db
        .select({ code: employees.employeeCode })
        .from(employees)
        .where(isNotNull(employees.employeeCode))
    ).map((r) => r.code),
  );

  const roleIds = new Map<Permission, string>();
  for (const r of await db
    .select({ id: roles.id, permission: roles.permission })
    .from(roles)
    .where(eq(roles.isSystem, true))) {
    roleIds.set(r.permission, r.id);
  }
  const passwordHash = await hashPassword(password);
  const ids: Record<string, string> = {};
  const names: Record<string, string> = {};
  for (const p of PEOPLE.filter((p) => withAdmin || p.permission !== 'ADMIN')) {
    const [row] = await db
      .insert(employees)
      .values({
        name: p.name,
        email: demoEmail(p.key),
        employeeCode: takenCodes.has(p.code) ? null : p.code,
        roleId: roleIds.get(p.permission)!,
        passwordHash,
        isCfo: p.permission === 'CFO',
      })
      .returning({ id: employees.id });
    ids[p.key] = row!.id;
    names[p.key] = p.name;
  }

  // Microtech has a parallel first step (two people, both must approve)
  const COMPANIES: Array<{
    key: string;
    name: string;
    code: string;
    chain: Array<[string, number]>;
  }> = [
    {
      key: 'mic',
      name: 'Microtech Pvt Ltd',
      code: 'MIC',
      chain: [
        ['priya', 1],
        ['arjun', 1],
        ['meera', 2],
      ],
    },
    {
      key: 'orb',
      name: 'Orbit Logistics',
      code: 'ORB',
      chain: [
        ['dev', 1],
        ['lina', 2],
      ],
    },
    {
      key: 'nim',
      name: 'Nimbus Traders',
      code: 'NIM',
      chain: [
        ['meera', 1],
        ['dev', 2],
      ],
    },
  ];
  const companyIds: Record<string, string> = {};
  for (const c of COMPANIES) {
    const [row] = await db
      .insert(companies)
      .values({ name: c.name, code: c.code })
      .returning({ id: companies.id });
    companyIds[c.key] = row!.id;
    await db
      .insert(companyDefaultApprovers)
      .values(
        c.chain.map(([who, position]) => ({ companyId: row!.id, employeeId: ids[who]!, position })),
      );
  }
  const chainOf = (key: string) =>
    COMPANIES.find((c) => c.key === key)!.chain.map(([who, position]) => ({
      employeeId: ids[who]!,
      position,
    }));

  const DOCS: Array<{
    file: string;
    company: string;
    creator: string;
    vendor: string;
    amount: string;
    steps: Step[];
  }> = [
    {
      file: 'Q3_Vendor_Invoice.pdf',
      company: 'mic',
      creator: 'rahul',
      vendor: 'Acme Supplies',
      amount: '48250.00',
      steps: [],
    },
    {
      file: 'Office_Lease_Renewal.pdf',
      company: 'mic',
      creator: 'sara',
      vendor: 'Skyline Estates',
      amount: '310000.00',
      steps: [['priya', 'APPROVE']],
    },
    {
      file: 'Freight_Charges_Sept.pdf',
      company: 'orb',
      creator: 'rahul',
      vendor: 'BlueLine Freight',
      amount: '12780.50',
      steps: [['dev', 'APPROVE', 'Rates match the contract']],
    },
    {
      file: 'Server_Hardware_PO.pdf',
      company: 'mic',
      creator: 'rahul',
      vendor: 'Nexa Systems',
      amount: '925400.00',
      steps: [
        ['arjun', 'APPROVE'],
        ['priya', 'APPROVE'],
        ['meera', 'APPROVE', 'Budget line 4.2 confirmed'],
      ],
    },
    {
      file: 'Annual_Audit_Fees.pdf',
      company: 'nim',
      creator: 'sara',
      vendor: 'Kapoor & Associates',
      amount: '185000.00',
      steps: [
        ['meera', 'APPROVE'],
        ['dev', 'APPROVE'],
        ['cfo', 'APPROVE', 'Approved for payment'],
      ],
    },
    {
      file: 'Marketing_Retainer.pdf',
      company: 'orb',
      creator: 'sara',
      vendor: 'Brightside Media',
      amount: '64000.00',
      steps: [['dev', 'REJECT', 'Scope of work is missing; resubmit with the signed SOW']],
    },
    {
      file: 'Consulting_Invoice_Aug.pdf',
      company: 'nim',
      creator: 'rahul',
      vendor: 'Vertex Advisory',
      amount: '220000.00',
      steps: [
        ['meera', 'APPROVE'],
        ['dev', 'APPROVE'],
        ['cfo', 'REJECT', 'Duplicate of invoice VA-1182, already paid'],
      ],
    },
  ];

  const workflowIds: string[] = [];
  for (const [i, d] of DOCS.entries()) {
    const body = demoPdf(d.file.replace(/_/g, ' ').replace(/\.pdf$/, ''));
    const uploadId = randomUUID();
    const objectKey = `uploads/${ids[d.creator]}/${uploadId}`;
    await db.insert(uploads).values({
      id: uploadId,
      objectKey,
      createdBy: ids[d.creator]!,
      fileName: d.file,
      fileMime: 'application/pdf',
      fileSize: body.length,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await storage.put(objectKey, body, 'application/pdf');
    const { id } = await submitWorkflow(db, storage, ids[d.creator]!, {
      uploadId,
      companyId: companyIds[d.company]!,
      approvers: chainOf(d.company),
      invoiceNumber: `INV-2026-${String(1040 + i)}`,
      vendorName: d.vendor,
      invoiceDate: '2026-09-15',
      amount: d.amount,
      currency: 'INR',
      notes: null,
    });
    for (const [who, decision, remarks] of d.steps) {
      await decide(
        db,
        { id: ids[who]!, name: names[who]! },
        id,
        decision === 'REJECT'
          ? { decision, remarks: remarks! }
          : { decision, remarks: remarks ?? null },
      );
    }
    workflowIds.push(id);
  }

  // Demo addresses can't receive mail: never let a future email provider try them
  await db
    .update(notificationOutbox)
    .set({ status: 'skipped' })
    .where(eq(notificationOutbox.status, 'pending'));

  const [{ active } = { active: 0 }] = await db
    .select({ active: count() })
    .from(employees)
    .where(and(eq(employees.isActive, true)));
  return { employees: active, companies: COMPANIES.length, workflows: workflowIds };
}
