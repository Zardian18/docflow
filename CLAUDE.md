# DocFlow — instructions for Claude Code

DocFlow v2 (decisions.md D24): tracks an export order from the buyer's first requirements to delivery, in three phases. Named people (Marketing, Creator, Approver, Head Approver) and team pools (Regulation, Materials, Design, Production, Accounts, Logistics) work on it through review loops, approval chains with ALL/ANY gates, per-product tasks and component tables. People work from their dashboards; v2 sends no email.

**v2 sources:** `docs/v2-brief.md` (the owner's requirements, never edit), `docs/v2-gap-analysis.md` (questions, data model, plan), `docs/v2-workflow.md` (the reviewed flow) and `docs/decisions.md` D24 onward. They replace `docs/URS.md` and the v1 parts of `docs/plan.md` wherever they differ.

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
| Demo data into an EMPTY database (refuses production and non-empty DBs) | `pnpm --filter @docflow/api seed:demo` (accounts `<name>@demo.docflow.test`, password `demo-password-1`; 10 orders parked in every phase, spread over realistic days) |
| Demo data on the live site, right after a reset (no demo Admin; prints a random password once) | `pnpm --filter @docflow/api seed:demo --live` (to reuse the owner's existing demo password, set `SEED_DEMO_PASSWORD` for that one run) |
| Test-data wipe (D21): **only on the owner's request, after a fresh backup run** | `pnpm --filter @docflow/api reset:data --keep <admin email>` (dry run), then add `--confirm` |
| Browser + accessibility tests (starts its own API and web build; needs Postgres) | `E2E_DATABASE_URL=postgres://…/docflow_e2e pnpm --filter @docflow/e2e e2e` (first time: `pnpm --filter @docflow/e2e exec playwright install chromium`) |
| Run a backup now (nightly otherwise; restore steps in `docs/runbook-backup.md`) | GitHub → Actions → **Backup** → Run workflow, or `gh workflow run backup.yml` |
| Create the first Admin (prints a one-time set-password link) | `pnpm --filter @docflow/api seed:admin --email <email> --name "<name>"` (needs `DATABASE_URL_DIRECT` and `WEB_ORIGIN` in `.env`) |

UI design reference: `docs/design/*.png` (the 9 Figma screens). Design tokens live in `apps/web/src/index.css`; reuse `PageHeader`, `ResponsiveTable`, `StatusPill` and `forms.tsx` for new screens, and check new pages at 375/768/1280/1440px with no clipping.

Files: `apps/api/src/storage/` (`StorageService`; B2 in production, `MemoryStorage` in unit tests, and `STORAGE_DRIVER=local` (disk, dev/CI only, refused in production) for E2E). Presigned PUTs sign content-type and content-length, so B2 itself refuses a different type or size. The S3 client must keep `requestChecksumCalculation`/`responseChecksumValidation` at `WHEN_REQUIRED`, because the SDK defaults break browser uploads to B2. The bucket CORS rule (B2 operation names `s3_put`/`s3_get`/`s3_head`) allows the web origin and `http://localhost:5173`.

Measured Render cold start: ~23–33 s for the first request after the service sleeps; warm ~0.2–0.5 s. The cron tick runs every 30 min so it does not act as a keep-alive (D15).

Security (Phase 7, `docs/security.md`):
- **Client IP:** `request.ip` trusts exactly `TRUSTED_PROXY_HOPS` proxies (3 on Render, measured). Never set `trustProxy: true`, which lets clients spoof IPs and bypass the rate limits.
- **Attached files** are copied to `documents/<orderId>/<uuid>` and checked there. Browsers only ever get write URLs for `uploads/…`.
- **Web headers:** the security headers, CSP included, are generated into `dist/_headers` by `apps/web/vite.config.ts`. When adding a new external origin the browser calls, add it there.
- **Dependencies:** `pnpm audit --audit-level high` runs in CI. Overrides and justified ignores live in `pnpm-workspace.yaml`.

Version notes: TypeScript is pinned to 6.0.x because typescript-eslint doesn't support 7.x yet. pnpm only runs install scripts for packages listed under `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>`).

## Invariants that must never be broken (v2)
1. **The workflow is data.** The steps, who holds them, loops, gates and dependencies live in `packages/shared/src/template.ts`. The engine (`apps/api/src/engine/`) implements a fixed set of step kinds and never branches on a step's name. To change the workflow, add a new template version and keep old ones while orders use them.
2. **Orders pin their template version.** Editing a template, a buyer's default chain or its gates never changes an order already created (the order keeps its own copy of the slots and gates). Only the order's Marketing person (or Admin) changes an order's approval stage, and only before that stage starts (D27, `editableSlots`).
3. **Two actor mechanisms, kept separate.** A team step is open to every current member of that team, and any one acts. A named step belongs to the specific people on the order's slot. A person can be in any number of teams with no exclusions; Admin acts on no step.
4. **Approval gates.** ALL needs every named person on the stage; ANY completes on the first approval. Votes are once per person per stage per run. A rejection needs a reason and goes where the template says: it reopens the earlier step, or restarts the chain.
5. **One person, several roles (D26).** A person can fill any number of named slots on the same order, the Creator included, as long as they hold each slot's capability. Each slot is a separate role: they act and vote once per stage in each, never once for several. `slotProblems` only checks gaps, one-person slots and duplicates.
6. **Every action runs in one transaction that locks the order row first** (`SELECT … FOR UPDATE`). It writes the task changes, the holder intervals and the `order_events` row together. Two people acting on the same step at once: one succeeds, the other gets 409.
7. **Everything tracked is an event:** `order_events` (actor, the team or slot they acted as, time, comment, details) is append-only, enforced by a trigger. Only `reset:data` (TRUNCATE) removes events. Component edits are also logged field by field in `component_changes`.
8. **Document access is by kind.** `template.docAccess` decides which teams may open each kind. The full PI never reaches Regulation, Materials or Design, enforced by the API (`canSeeDoc`), never only by the UI. Named people and Admin see every document of their orders.
9. **Visibility.** Admin sees every order. Named people see theirs. Team members see an order from the phase their team joins (`teamVisibleFrom`). An order someone can't see is a 404, never a 403.
10. **Clocks.** Tracker B starts at "Buyer confirmed the CBM", Tracker A at Accounts verifying the advance. Both count calendar days in India time and are always shown with their date. Tracker C is the time the current holder has held a task, summed from `holder_intervals` and rounded up to whole days. All timestamps are stored in UTC.
11. **No email in v2** (D24). People sign in and work from their dashboards. Don't add sending without a new decision.
12. **Login** authenticates by `employees.email`, not an employee code.

## Free-tier constraints that shape the code
- **No card on file anywhere** (Cloudflare, Google, or otherwise). This is why the API is on Render (not Google Cloud Run) and files are on Backblaze B2 (not Cloudflare R2) — both confirmed free with no payment method required.
- If email is ever added back (it isn't in v2, invariant 11), it must go over an HTTPS provider API (Brevo or Resend). **No SMTP**: Render blocks outbound ports 25/465/587.
- **No always-on polling loop or job worker**, and no artificial "keep-alive ping" to Render either. Background work only runs from `POST /internal/tick`, triggered by the Cloudflare Worker cron every ~30 minutes; in v2 it only does housekeeping (abandoned uploads, old sessions). Keeping Render artificially warm is unsupported by Render and unnecessary.
- The API is stateless with an ephemeral filesystem. Files live in Backblaze B2 via presigned URLs (S3-compatible API, same `@aws-sdk/client-s3` client as R2 would have used — only the endpoint/credentials differ); never proxy file bytes through the API.
- Use a standard TCP Postgres driver (`pg`) on Neon's pooled endpoint (interactive transactions are required for invariant 6; run every statement of a transaction on one `pool.connect()` client). PgBouncer transaction mode rejects session-level features (`SET`, `LISTEN`, session advisory locks), so migrations use the direct URL.
- Render's free tier has no pre-deploy command: migrations run at container start, under a Postgres advisory lock.
- Keep storage, email, and DB access behind interfaces so the provider can be swapped by configuration alone.
- Frontend is on Cloudflare (Workers static assets, an assets-only Worker), not Vercel — Vercel's free Hobby plan forbids commercial use (explicitly including a paid consultant writing the code), which this project is. Cloudflare's free plan needs no card and allows commercial use.
- `VITE_*` values are baked in at build time, so on Cloudflare they must be **build** variables, not runtime variables.

## Definition of done (every task)
Types check, lint clean, tests pass in CI, migrations included and reversible-in-practice, no secrets or PII in logs, `docs/decisions.md` updated (never `docs/URS.md`) if a new decision was made along the way, and `CLAUDE.md` updated if a command or invariant changed.
