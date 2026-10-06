// Creates the first Admin (or re-issues their link) and prints a one-time set-password
// link to this terminal only (decisions.md D16). Usage:
//   pnpm --filter @docflow/api seed:admin --email admin@company.com --name "A. Mehta"
import { parseArgs } from 'node:util';
import { Email } from '@docflow/shared';
import { and, eq } from 'drizzle-orm';
import { issuePasswordLink } from './auth/password-links.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { employees, roles } from './db/schema.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, name: { type: 'string' } },
});

const email = Email.safeParse(values.email ?? '');
const name = values.name?.trim();
const directUrl = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
const webOrigin = process.env.WEB_ORIGIN;

if (!email.success || !name) {
  console.error('Usage: seed:admin --email <email> --name "<full name>"');
  process.exit(1);
}
if (!directUrl || !webOrigin) {
  console.error('DATABASE_URL_DIRECT (or DATABASE_URL) and WEB_ORIGIN must be set (root .env)');
  process.exit(1);
}

await runMigrations(directUrl);
const { pool, db } = createDb(directUrl);
try {
  const [adminRole] = await db
    .select({ id: roles.id })
    .from(roles)
    .where(and(eq(roles.isSystem, true), eq(roles.permission, 'ADMIN')));
  if (!adminRole) throw new Error('System Admin role missing; migrations did not run?');

  const [existing] = await db
    .select({ id: employees.id, roleId: employees.roleId })
    .from(employees)
    .where(eq(employees.email, email.data));

  let employeeId: string;
  if (existing) {
    if (existing.roleId !== adminRole.id) {
      throw new Error(
        `${email.data} exists but is not an Admin; change their role in the app instead`,
      );
    }
    employeeId = existing.id;
    console.log(`Admin ${email.data} already exists; issuing a new set-password link.`);
  } else {
    const [created] = await db
      .insert(employees)
      .values({ name, email: email.data, roleId: adminRole.id })
      .returning({ id: employees.id });
    employeeId = created!.id;
    console.log(`Created Admin ${name} <${email.data}>.`);
  }

  const link = await issuePasswordLink(db, webOrigin, employeeId, 'SET');
  console.log(
    `\nSet-password link (one-time, expires ${link.expiresAt.toISOString()}):\n${link.url}\n`,
  );
} finally {
  await pool.end();
}
