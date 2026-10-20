import {
  CompanyOption,
  IdParam,
  PeopleSearchQuery,
  PersonOption,
  SlotAssignment,
} from '@docflow/shared';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { buyers, companies, employeeCapabilities, employees } from '../db/schema.js';
import { notFound } from '../errors.js';
import { requireCapability, requireUser } from '../plugins/auth.js';
import { slotsFor } from './companies.js';
import type { RouteDeps } from './deps.js';
import { prefixPattern } from './query-helpers.js';

/** Pickers: people who can fill a named slot, and the active buyers and companies. */
export const lookupRoutes: FastifyPluginAsyncZod<RouteDeps> = async (app, { db }) => {
  app.get(
    '/v1/lookups/people',
    {
      onRequest: requireCapability('ADMIN', 'MARKETING'),
      schema: { querystring: PeopleSearchQuery, response: { 200: PersonOption.array() } },
    },
    async ({ query }) =>
      db
        .select({ id: employees.id, name: employees.name, email: employees.email })
        .from(employees)
        .innerJoin(employeeCapabilities, eq(employeeCapabilities.employeeId, employees.id))
        .where(
          and(
            eq(employees.isActive, true),
            eq(employeeCapabilities.capability, query.capability),
            query.q ? sql`lower(${employees.name}) like ${prefixPattern(query.q)}` : undefined,
          ),
        )
        .orderBy(asc(sql`lower(${employees.name})`))
        .limit(20),
  );

  app.get(
    '/v1/lookups/companies',
    {
      onRequest: requireUser,
      schema: {
        querystring: z.object({ q: z.string().trim().max(100).default('') }),
        response: { 200: CompanyOption.array() },
      },
    },
    async ({ query }) => {
      const pattern = query.q ? prefixPattern(query.q) : undefined;
      return db
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
        .limit(20);
    },
  );

  // The company's named people, to start a new order from (Marketing, Q61)
  app.get(
    '/v1/lookups/companies/:id/slots',
    {
      onRequest: requireCapability('ADMIN', 'MARKETING'),
      schema: { params: IdParam, response: { 200: SlotAssignment.array() } },
    },
    async ({ params }) => {
      const slots = (await slotsFor(db, [params.id])).get(params.id);
      const [exists] = await db
        .select({ id: companies.id })
        .from(companies)
        .where(eq(companies.id, params.id));
      if (!exists || !slots) throw notFound('Company');
      return slots;
    },
  );

  app.get(
    '/v1/lookups/buyers',
    {
      onRequest: requireUser,
      schema: {
        querystring: z.object({ q: z.string().trim().max(100).default('') }),
        response: {
          200: z.array(
            z.object({ id: z.uuid(), name: z.string(), country: z.string().nullable() }),
          ),
        },
      },
    },
    async ({ query }) =>
      db
        .select({ id: buyers.id, name: buyers.name, country: buyers.country })
        .from(buyers)
        .where(
          and(
            eq(buyers.isActive, true),
            query.q ? sql`lower(${buyers.name}) like ${prefixPattern(query.q)}` : undefined,
          ),
        )
        .orderBy(asc(sql`lower(${buyers.name})`))
        .limit(20),
  );
};
