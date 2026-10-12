import {
  ApproverOption,
  ApproverSearchQuery,
  CfoInfo,
  CompanyOption,
  CompanySearchQuery,
} from '@docflow/shared';
import { and, asc, eq, ne, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { companies, employeeRoles, employees, roles } from '../db/schema.js';
import { activeCfo, defaultApproversFor } from '../domain/chain.js';
import { currentUser, requirePermission } from '../plugins/auth.js';
import type { RouteDeps } from './deps.js';
import { prefixPattern } from './query-helpers.js';

/** Type-ahead lookups shared by Admin (masters) and Creator (new submission). */
export const lookupRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db }) => {
  app.addHook('onRequest', requirePermission('ADMIN', 'CREATOR'));

  // Approver picker: only active employees holding an active APPROVER role (D3, invariant 11),
  // never the person searching: someone who is both Creator and Approver can't approve their
  // own document (D23). Matches the start of the name, case-insensitively (URS §5.2).
  app.get(
    '/v1/employees/approver-search',
    { schema: { querystring: ApproverSearchQuery, response: { 200: ApproverOption.array() } } },
    async (request) =>
      db
        .select({
          id: employees.id,
          name: employees.name,
          email: employees.email,
          roleName: roles.name,
        })
        .from(employees)
        .innerJoin(
          employeeRoles,
          and(eq(employeeRoles.employeeId, employees.id), eq(employeeRoles.permission, 'APPROVER')),
        )
        .innerJoin(roles, eq(roles.id, employeeRoles.roleId))
        .where(
          and(
            eq(employees.isActive, true),
            eq(roles.isActive, true),
            ne(employees.id, currentUser(request).id),
            request.query.q
              ? sql`lower(${employees.name}) like ${prefixPattern(request.query.q)}`
              : undefined,
          ),
        )
        .orderBy(asc(sql`lower(${employees.name})`))
        .limit(10),
  );

  // Company picker for New Submission: Active companies only, matching the start of the
  // name OR the code (URS §5.2), with each company's default chain and the current CFO.
  app.get(
    '/v1/companies/search',
    {
      schema: {
        querystring: CompanySearchQuery,
        response: { 200: z.object({ companies: CompanyOption.array(), cfo: CfoInfo.shape.cfo }) },
      },
    },
    async ({ query }) => {
      const pattern = query.q ? prefixPattern(query.q) : undefined;
      const rows = await db
        .select({ id: companies.id, name: companies.name, code: companies.code })
        .from(companies)
        .where(
          and(
            eq(companies.isActive, true),
            pattern
              ? or(
                  sql`lower(${companies.name}) like ${pattern}`,
                  sql`lower(${companies.code}) like ${pattern}`,
                )
              : undefined,
          ),
        )
        .orderBy(asc(sql`lower(${companies.name})`))
        .limit(10);
      const chains = await defaultApproversFor(
        db,
        rows.map((r) => r.id),
      );
      return {
        companies: rows.map((r) => ({ ...r, approvers: chains.get(r.id) ?? [] })),
        cfo: await activeCfo(db),
      };
    },
  );
};
