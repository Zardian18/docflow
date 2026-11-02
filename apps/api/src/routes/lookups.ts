import {
  BuyerOption,
  IdParam,
  PeopleSearchQuery,
  PersonOption,
  SlotAssignment,
} from '@docflow/shared';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { buyers, employeeCapabilities, employees } from '../db/schema.js';
import { notFound } from '../errors.js';
import { requireCapability, requireUser } from '../plugins/auth.js';
import { slotsFor } from './buyers.js';
import type { RouteDeps } from './deps.js';
import { prefixPattern } from './query-helpers.js';

/** Pickers: people who can fill a named slot, and the active buyers. */
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

  // The buyer's default chain, to start a new order from (Marketing, Q61, D27)
  app.get(
    '/v1/lookups/buyers/:id/slots',
    {
      onRequest: requireCapability('ADMIN', 'MARKETING'),
      schema: { params: IdParam, response: { 200: SlotAssignment.array() } },
    },
    async ({ params }) => {
      const [exists] = await db
        .select({ id: buyers.id })
        .from(buyers)
        .where(eq(buyers.id, params.id));
      if (!exists) throw notFound('Buyer');
      return (await slotsFor(db, [params.id])).get(params.id)!;
    },
  );

  app.get(
    '/v1/lookups/buyers',
    {
      onRequest: requireUser,
      schema: {
        querystring: z.object({ q: z.string().trim().max(100).default('') }),
        response: { 200: BuyerOption.array() },
      },
    },
    async ({ query }) => {
      const pattern = query.q ? prefixPattern(query.q) : undefined;
      return db
        .select({ id: buyers.id, name: buyers.name, code: buyers.code, country: buyers.country })
        .from(buyers)
        .where(
          and(
            eq(buyers.isActive, true),
            pattern
              ? or(
                  sql`lower(${buyers.name}) like ${pattern}`,
                  sql`lower(${buyers.code}) like ${pattern}`,
                )
              : undefined,
          ),
        )
        .orderBy(asc(sql`lower(${buyers.name})`))
        .limit(20);
    },
  );
};
