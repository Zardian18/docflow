// Creates the first Admin (or re-issues their link) and prints a one-time set-password
// link to this terminal only (decisions.md D16). Usage:
//   pnpm --filter @docflow/api seed:admin --email admin@company.com --name "A. Mehta"
import { parseArgs } from 'node:util';
import { Email } from '@docflow/shared';
import { eq } from 'drizzle-orm';
import { issuePasswordLink } from './auth/password-links.js';
import { createDb } from './db/client.js';
import { runMigrations } from './db/migrations.js';
import { capabilitiesOf } from './auth/sessions.js';
import { employeeCapabilities, employees } from './db/schema.js';

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
  const [existing] = await db
    .select({ id: employees.id, capabilities: capabilitiesOf })
    .from(employees)
    .where(eq(employees.email, email.data));

  let employeeId: string;
  if (existing) {
    if (!existing.capabilities.includes('ADMIN')) {
      throw new Error(
        `${email.data} exists but is not an Admin; change their access in the app instead`,
      );
    }
    employeeId = existing.id;
    console.log(`Admin ${email.data} already exists; issuing a new set-password link.`);
  } else {
    employeeId = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(employees)
        .values({ name, email: email.data })
        .returning({ id: employees.id });
      await tx
        .insert(employeeCapabilities)
        .values({ employeeId: created!.id, capability: 'ADMIN' });
      return created!.id;
    });
    console.log(`Created Admin ${name} <${email.data}>.`);
  }

  const link = await issuePasswordLink(db, webOrigin, employeeId, 'SET');
  console.log(
    `\nSet-password link (one-time, expires ${link.expiresAt.toISOString()}):\n${link.url}\n`,
  );
} finally {
  await pool.end();
}
