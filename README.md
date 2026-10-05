# DocFlow

Document Approval Workflow Management System. A Creator uploads a document, picks a company, and submits it through that company's ordered approval chain (sequential and/or parallel steps), always ending with the single, fixed CFO. Approvers are emailed when their step is reached; every decision is kept in an append-only audit trail.

- **Web:** React + Vite SPA on Cloudflare Pages (`apps/web`)
- **API:** Fastify + TypeScript in Docker on Render (`apps/api`)
- **Shared:** zod schemas and enums used by both (`packages/shared`)
- **Cron worker:** Cloudflare Worker that calls `/internal/tick` to retry failed emails (`infra/cron-worker`)
- **Data:** Postgres on Neon, files on Backblaze B2, email via Brevo or Resend. No card on file anywhere.

Start with `CLAUDE.md`, then `docs/plan.md`, `docs/decisions.md` and `docs/URS.md` (the URS is never edited; deviations live in `decisions.md`).

**Status:** Phase 0 (repo skeleton). No product code yet. Requires Node 24+ and pnpm (`corepack enable`).
