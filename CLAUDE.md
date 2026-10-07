# DocFlow — instructions for Claude Code

Document Approval Workflow Management System. A Creator uploads a document, it passes through an ordered approval chain (sequential and/or parallel steps, ending with a fixed CFO), and people are emailed when it is their turn.

## Where the reference documents are

These files should exist at the paths below. **If any of them are missing, that means Phase 0 has not been run yet or they haven't been copied into the repo — stop and tell the owner, don't guess at their contents.**

- `docs/URS.md` — the client's original requirements. **Never edit this file.** Where the project has deliberately deviated from it, the deviation is recorded in `docs/decisions.md`, not by changing this file.
- `docs/decisions.md` — the owner's answers to every open question, dated. **This is the source of truth whenever it conflicts with `docs/URS.md`.**
- `docs/plan.md` — architecture, hosting, schema, and the phase-by-phase build plan. Read the whole file, not just the phase you're on; later phases assume earlier sections.
- Figma file `WxKMZgyyYg9RVUIYDfuzhq`, page "App Screens" — node IDs for each of the 9 designed screens are listed in `docs/plan.md` v0.2 §1.1. Several required screens aren't designed at all (Employee/Role masters, History pages, the admin audit-trail detail page, password reset) — build these from the same tokens/components as the designed screens and say what you invented.

If `docs/decisions.md` says a decision is still `OPEN` and the task in front of you needs it, **stop and ask**, don't pick an answer yourself.

## Working rules
- **Do not assume.** If a requirement is ambiguous, or a decision in `docs/decisions.md` is still OPEN, list your questions and stop.
- **Do not hallucinate APIs.** Check the current official docs for any library or service before using it. Pin exact versions.
- **Plan first.** Propose a plan and wait for approval before writing code. Work in small commits.
- **Tests with every rule.** Each business rule from the URS (or its override in `decisions.md`) gets a test. The approval engine must have real-concurrency tests, including two approvers in the same parallel group deciding at the same instant.
- Never commit secrets. Configuration comes from validated environment variables (`.env.example` lists names only).
- When Figma has no design for a screen, reuse the existing tokens/components and tell the owner what you invented.

## Layout
`apps/web` React SPA → **Cloudflare Workers static assets** (Worker `docflow`) · `apps/api` Fastify API in Docker → **Render** free web service · `packages/shared` zod schemas and enums used by both · `infra/cron-worker` Cloudflare Worker `docflow-cron` calling `/internal/tick` on a cron trigger (retry safety net, not a keep-alive — see invariant 10) · `docs/`

Deploys happen through each host's own git integration on push to `main` (Render; Cloudflare Workers Builds). GitHub Actions only runs CI. Hosting details and dashboard settings: `docs/decisions.md` D15.

## Commands
pnpm 12 via corepack (`corepack enable`, or `corepack pnpm …` if the shims can't be installed). Node 24+. Local config: root `.env` (gitignored; see `.env.example`).

| Task | Command |
|---|---|
| Install | `pnpm install` |
| Typecheck / lint / format / test / build (all packages) | `pnpm typecheck` · `pnpm lint` · `pnpm format` (`format:check` in CI) · `pnpm test` · `pnpm build` |
| API dev server (reads root `.env`) | `pnpm --filter @docflow/api dev` |
| Generate a migration after editing `apps/api/src/db/schema.ts` | `pnpm --filter @docflow/api db:generate --name <name>` |
| Apply migrations (direct URL) | `pnpm --filter @docflow/api db:migrate` (production runs this on container start) |
| API DB integration tests | set `TEST_DATABASE_URL`, then `pnpm --filter @docflow/api test` (skipped without it; CI provides Postgres) |
| Web dev server | `pnpm --filter @docflow/web dev` (set `VITE_API_BASE_URL`, e.g. `http://localhost:3000`) |
| Add a shadcn component | `cd apps/web && pnpm dlx shadcn@4.21.1 add <name>` |
| Cron worker locally | `pnpm --filter @docflow/cron-worker dev`, then `curl http://localhost:8787/cdn-cgi/local/scheduled` |
| Regenerate Worker types after editing a `wrangler.jsonc` | `pnpm --filter @docflow/cron-worker types` |
| Local Postgres (needs Docker) | `docker compose up -d` |
| Create the first Admin (prints a one-time set-password link) | `pnpm --filter @docflow/api seed:admin --email <email> --name "<name>"` (needs `DATABASE_URL_DIRECT` and `WEB_ORIGIN` in `.env`) |

UI design reference: `docs/design/*.png` (the 9 Figma screens). Design tokens live in `apps/web/src/index.css`; reuse `PageHeader`, `ResponsiveTable`, `StatusPill` and `forms.tsx` for new screens, and check new pages at 375/768/1280/1440px with no clipping.

Files: `apps/api/src/storage/` (`StorageService`; B2 in production, `MemoryStorage` in tests). Presigned PUTs sign content-type and content-length, so B2 itself refuses a different type or size. The S3 client must keep `requestChecksumCalculation`/`responseChecksumValidation` at `WHEN_REQUIRED`, because the SDK defaults break browser uploads to B2. The bucket CORS rule (B2 operation names `s3_put`/`s3_get`/`s3_head`) allows the web origin and `http://localhost:5173`.

Measured Render cold start: ~23–33 s for the first request after the service sleeps; warm ~0.2–0.5 s. The cron tick runs every 30 min so it does not act as a keep-alive (D15).

Version notes: TypeScript is pinned to 6.0.x because typescript-eslint doesn't support 7.x yet. pnpm only runs install scripts for packages listed under `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>`).

## Invariants that must never be broken
1. Approval proceeds in strict step order. A step may have **one or more** approvers (a parallel group when more than one); every approver in the step must approve before the workflow advances. A pending document is never visible to an approver whose step hasn't been reached (API-enforced, not just UI).
2. The approver chain is **snapshotted** at submit into `workflow_steps`. Later edits to masters never change an existing workflow.
3. A Creator's per-document changes (add, remove, reorder) never write to Company Master.
4. The CFO is a single, global, active employee, always the final step, always a group of one, never movable or removable by a Creator.
5. Rejection requires a non-empty reason and is final. **Any** rejection, anywhere in the chain, ends the whole workflow immediately (skips every other open step) and notifies the Creator and the CFO. Terminal states are immutable.
6. Every decision runs in one transaction with `SELECT … FOR UPDATE` on the workflow row; it also writes the audit event and the `notification_outbox` rows in that same transaction.
7. `audit_events` is append-only. Employees and roles are deactivated, never deleted.
8. Emails contain links, never the document, and there is no approve-from-email action.
9. All timestamps stored in UTC.
10. **Notification sends are synchronous and best-effort, fired immediately after the transaction in step 6 commits, inside the same request that caused the event.** The cron tick only retries rows still `pending`/`failed`; it is a safety net for provider hiccups, not the primary delivery path, and it must never be the *only* place a send is attempted. (Reasoning: every event that needs an email happens inside a live request from a logged-in person, so the server is never asleep at the moment it matters — see `docs/plan.md` §2.4.)
11. Only employees whose role has `permission = APPROVER` can be selected in a company's default approver list or a Creator's per-document "add approver" search. Creator-permission employees never appear there, which is what makes self-approval structurally impossible, not just a UI rule.
12. Login authenticates by `employees.email`, not an employee code.

## Free-tier constraints that shape the code
- **No card on file anywhere** (Cloudflare, Google, or otherwise). This is why the API is on Render (not Google Cloud Run) and files are on Backblaze B2 (not Cloudflare R2) — both confirmed free with no payment method required.
- Email goes over an HTTPS provider API (Brevo or Resend). **No SMTP** — Render blocks outbound ports 25/465/587.
- **No always-on polling loop or job worker**, and no artificial "keep-alive ping" to Render either. Background work only runs from `POST /internal/tick`, triggered by the Cloudflare Worker cron every ~15–30 minutes, and its only job is retrying failed outbox rows (see invariant 10). Keeping Render artificially warm is both unsupported by Render and unnecessary given invariant 10.
- The API is stateless with an ephemeral filesystem. Files live in Backblaze B2 via presigned URLs (S3-compatible API, same `@aws-sdk/client-s3` client as R2 would have used — only the endpoint/credentials differ); never proxy file bytes through the API.
- Use a standard TCP Postgres driver (`pg`) on Neon's pooled endpoint (interactive transactions are required for invariant 6; run every statement of a transaction on one `pool.connect()` client). PgBouncer transaction mode rejects session-level features (`SET`, `LISTEN`, session advisory locks), so migrations use the direct URL.
- Render's free tier has no pre-deploy command: migrations run at container start, under a Postgres advisory lock.
- Keep storage, email, and DB access behind interfaces so the provider can be swapped by configuration alone.
- Frontend is on Cloudflare (Workers static assets, an assets-only Worker), not Vercel — Vercel's free Hobby plan forbids commercial use (explicitly including a paid consultant writing the code), which this project is. Cloudflare's free plan needs no card and allows commercial use.
- `VITE_*` values are baked in at build time, so on Cloudflare they must be **build** variables, not runtime variables.

## Definition of done (every task)
Types check, lint clean, tests pass in CI, migrations included and reversible-in-practice, no secrets or PII in logs, `docs/decisions.md` updated (never `docs/URS.md`) if a new decision was made along the way, and `CLAUDE.md` updated if a command or invariant changed.
