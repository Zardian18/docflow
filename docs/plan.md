# DocFlow — Implementation Plan

**Document Approval Workflow Management System**
Version 0.3 · Updated 5 Oct 2026 (Phase 1: hosting reconciled with what was actually set up — see `decisions.md` D15)
Inputs: `URS.md` (converted from the client's URS.docx v1.0, 25 Aug 2026), the Figma file "Document Approval Workflow — App Design" (9 screens), and `decisions.md` (owner's answers, 29 Sep 2026 — read that file for the full reasoning behind every D-numbered decision referenced here)

> **This is the single, current, self-contained plan.** It replaces two earlier drafts (v0.1, and a v0.2 patch that referenced v0.1) — everything from both is folded in here so there is nothing else to cross-reference.

---

## 0. How to use this document

1. Read `decisions.md` first — it has the owner's answers to every open question, several with reasoning you'll need.
2. Put this file, `URS.md`, `decisions.md` and `CLAUDE.md` into the repo as described in §2.5.
3. Feed Claude Code **one phase at a time** using the prompts in §5. Each Claude Code session starts with a fresh context window, so every prompt is self-contained and points at files in the repo instead of relying on chat history.
4. Do not start the next phase until the previous phase's **Gate** is met.
5. Anything below still marked **OPEN** needs an answer before the phase that depends on it; Claude Code is instructed to stop and ask rather than guess.

---

## 1. Figma inventory and where the URS, Figma, and the owner's own message disagreed

### 1.1 Figma screens (file key `WxKMZgyyYg9RVUIYDfuzhq`, page "App Screens")

| # | Screen | Node ID | Built in phase |
|---|---|---|---|
| 01 | Login | `3:2` | 2 |
| 02 | Admin Dashboard (stat cards, filters, table) | `3:21` | 6 |
| 03 | Admin — Masters (Company Master tab only) | `4:2` | 2 |
| 04 | Creator — New Submission (upload, company search, chain builder) | `4:106` | 3 |
| 05 | Creator — My Submissions | `5:2` | 3 |
| 06 | Approver — My Approvals (pending list) | `6:2` | 4 |
| 07 | Approver — Review Document (audit trail + decision) | `5:86` | 4 |
| 08 | CFO — Review Document | `6:84` | 4 |
| 09 | CFO — Dashboard (pending final approval) | `6:158` | 4 |

**Not designed in Figma at all** (build from the same tokens/components): Employee Master UI, Role Master UI, Add/Edit Company form with an ordered approver picker, the "Add Approver" search control, Approver/CFO **History** pages, the admin workflow detail/audit-trail page, Creator submission detail, forgot/change password, empty/loading/error states, and mobile layouts (Figma is 1440px desktop-only; URS §9 calls for a responsive web app).

### 1.2 Conflicts, and how they were resolved (full detail in `decisions.md`)

| # | Conflict | Resolution |
|---|---|---|
| C1 | Owner wanted parallel approvers; URS requires strictly unique, sequential positions | **D1:** both supported, via shared step numbers — see §4.5 |
| C2 | Owner wanted the CFO notified on rejection; URS says only the Creator | **D2:** Creator + CFO on both rejection and completion — see §4.6 |
| C3 | Owner called them invoices; URS/Figma are generic | **D6:** yes, invoice fields added — see §4.4 |
| C4 | URS logs in by employee Id; Figma's login field says "Email" | **D4:** login by email |
| C5 | URS only lets a Creator add/reorder approvers; Figma shows a remove control | **D3(d):** Creator may add, remove, and reorder (not CFO) |
| C6 | URS says Creator and Approver never overlap; Figma's sample data shows the same person as both | **D3:** confirmed separate roles; Figma's reused name was sample-data noise, not a requirement. Approver pickers now only list `permission = APPROVER` employees, making self-approval structurally impossible |
| C7 | URS puts Export/analytics out of scope; Figma's dashboard has both | **D7:** still open — recommend dropping Export, keeping the simple count cards; confirm before Phase 6 |
| C8 | URS leaves file type/size as an open question; Figma implies PDF/DOCX ≤10MB | Treated as the working default; not yet a formal decision |
| C9 | URS calls for a responsive web app; Figma is desktop-only | **D14 (partial):** build responsive layouts regardless; Figma gives visual direction, not literal breakpoints |

---

## 2. Architecture

### 2.1 Overview

```
 Browser ──HTTPS──► Cloudflare Worker (static assets) ── React SPA ── app.<domain-once-bought>
    │                                    (today: docflow.<subdomain>.workers.dev)
    │ HTTPS + session cookie
    ▼
 API: Node + Fastify in a Docker container ── Render (free web service)
    │                                          (today: <service>.onrender.com)
    ├──► Postgres (Neon, pooled TCP connection)
    ├──► Object storage: Backblaze B2 via the S3-compatible API
    │       browser uploads/downloads DIRECTLY with short-lived presigned URLs
    └──► Email provider HTTP API (Brevo or Resend) ──► approvers' inboxes

 Cloudflare Worker (cron trigger, every ~15-30 min) ──► POST /internal/tick
        purpose: retry any FAILED/pending outbox rows only (safety net, NOT a keep-alive)
 GitHub Actions: CI on every PR · deploy on merge · nightly pg_dump → a second Backblaze B2 bucket
```

### 2.2 Stack and why

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript (strict) everywhere | One language; shared zod schemas between web and API remove contract drift (**D13**, confirmed) |
| Frontend hosting | **Cloudflare Workers static assets** (assets-only Worker `docflow`; originally planned as Pages — D15) | Confirmed free, no card, and **explicitly allows commercial use** — the direct replacement for what Vercel would have given, without Vercel's non-commercial restriction (see §3) |
| Frontend | React + Vite SPA, React Router, TanStack Query, TanStack Table, Tailwind CSS, shadcn/ui, react-hook-form + zod, dnd-kit (drag-reorder), date-fns | Every screen is behind login, so SSR/SEO gives nothing; a static SPA is the cheapest and most decoupled thing to host |
| Backend hosting | **Render** (free web service, Docker) | Confirmed no card required. Spins down after ~15 min idle — §2.4 explains why this doesn't delay notifications |
| Backend | Fastify + zod type provider, `@fastify/cookie`, `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit`, pino logging | Small and fast to cold-start (matters on Render's free tier) |
| DB | PostgreSQL on Neon | Row-level locking for the approval engine (§4.7), unique constraints, real transactions, no card required |
| ORM/migrations | Drizzle ORM + drizzle-kit | Thin, SQL-like, migrations checked into git and reviewable |
| DB driver | Standard TCP Postgres driver over Neon's **pooled** endpoint | The engine needs interactive transactions with `SELECT … FOR UPDATE`; Neon's HTTP driver does not support these — **VERIFY AT BUILD** against current Neon docs |
| Auth | Server-side sessions in Postgres, opaque token in an HttpOnly/Secure cookie, `argon2` password hashes, **login by email** (D4) | Instantly revocable — deactivating an employee ends their access immediately, which an approval/audit system needs |
| Files | **Backblaze B2**, private bucket, presigned PUT/GET via `@aws-sdk/client-s3` + presigner (B2's S3-compatible API works with the same client) | Confirmed 10 GB free, no card required, free egress up to 3x stored data. Kept behind a `StorageService` interface so a future move to R2 or S3 is a config change |
| Email | `EmailProvider` interface: Brevo (300/day) or Resend (100/day, 3,000/month); plain HTTPS calls | HTTPS only — Render blocks SMTP ports 25/465/587 |
| Background work | **Transactional outbox** + synchronous best-effort send + a low-frequency retry tick | See §2.4 — this is the piece that answers "won't Render's sleep delay emails?" |
| Tests | Vitest (unit/integration against real Postgres), Playwright (end-to-end) | The engine is the risky part; needs real-concurrency tests, including two approvers in the same parallel group |
| Tooling | pnpm workspaces, ESLint, Prettier, GitHub Actions | |

### 2.3 Why the client's domain matters, and what to do before it exists (D11)
1. **Email deliverability:** transactional providers need the sender domain verified with SPF/DKIM DNS records to send reliably (Resend's/Brevo's exact steps: **VERIFY AT BUILD**).
2. **Cookies:** the SPA and API are separate deployments on separate providers (Cloudflare Workers, Render). Until a domain exists, they sit on unrelated default domains (`*.workers.dev`, `*.onrender.com`), so the session cookie must be `SameSite=None; Secure` to survive cross-site — workable, but weaker than same-site. Once the client's domain exists, point `app.<domain>` at Cloudflare Workers and `api.<domain>` at Render (both support free custom domains/CNAMEs), switch the cookie to `SameSite=Lax`, and retest login. Do this before go-live.

### 2.4 Why Render's 15-minute sleep does not delay emails (confirming the owner's own reasoning)

Every notification trigger in this system fires **inside a request made by a logged-in person who is actively using the app at that moment**. Walking URS §5.6's full list:
- "Submitted" fires while the **Creator** is mid-submit request → server is awake, because that request is what's happening right now.
- "Your turn" (next step, or next parallel group) fires while the **previous approver(s)** are mid-decision request.
- "CFO notified" fires while the **last approver** is mid-decision request.
- "Completed"/"Rejected" fire while the **CFO or a rejecting approver** is mid-decision request.

In every case the server cannot be asleep at the moment the email needs to be triggered, because that moment *is* a live request being processed. So:

1. **Send attempt is synchronous and best-effort**, immediately after the transaction that recorded the decision commits, inside that same request. Most emails go out with zero delay, because the server is, by construction, already awake.
2. **The Cloudflare Worker cron tick is a safety net only**, for the rare case the email provider itself has a transient failure at that exact moment. It retries `notification_outbox` rows still `pending`/`failed`, every 15–30 minutes. If Render has gone back to sleep by the time the tick fires, the tick's own HTTP request wakes it (≈30–60s cold start) and it processes the retry then.
3. **What Render's sleep actually costs** is that the *next* person — clicking the link in the email they just received — may wait up to about a minute on their first click if the server had gone quiet since the last activity. **The email itself is never late; only that person's first page load might be.**

Deliberately **not** done: an artificial "ping every 10 minutes to stay awake forever" workaround. Render's own community says this is unsupported, and it's unnecessary given the reasoning above — the useful safety net (retrying genuinely failed sends) is satisfied by the same low-frequency tick, which also keeps well inside Render's 750 free instance-hours/month.

### 2.5 Repo and project structure — two deployable apps, one Git repository

```
docflow/
├─ CLAUDE.md                    # instructions Claude Code reads every session
├─ docs/
│  ├─ URS.md                    # converted from URS.docx (never edited by Claude)
│  ├─ plan.md                   # this document
│  ├─ decisions.md              # answers to D1–D14, with dates
│  └─ design/                   # Figma screenshots (optional)
├─ apps/
│  ├─ web/                      # React SPA  → Cloudflare Workers (static assets)
│  └─ api/                      # Fastify API → Docker → Render
├─ packages/
│  └─ shared/                   # zod schemas, enums (WorkflowStatus…), types
├─ infra/
│  └─ cron-worker/              # Cloudflare Worker `docflow-cron` that calls /internal/tick
└─ .github/workflows/           # ci.yml, backup.yml — deploys use each host's own git integration (D15)
```

Why a monorepo: Claude Code can change an API contract and the screen that uses it in one session and one commit; shared zod types make a mismatch a compile error. Split into two repos only if different teams/vendors own each half — `packages/shared` can be published as a package if that day comes.

---

## 3. Free-tier reality check (verified 29 Sep 2026)

| Service | What's free | Status here |
|---|---|---|
| **Cloudflare Workers static assets** | No card | **In use** (frontend; the plan originally said Pages — D15). Explicitly allows commercial use, unlike Vercel Hobby |
| **Cloudflare Workers (cron trigger only)** | 100K requests/day, cron triggers included, no card | **In use** (retry tick) — only Cloudflare's *R2* product prompts for a payment method, not Workers/Pages |
| **Vercel Hobby** | Generous limits, but **non-commercial use only**; explicitly defines commercial use to include "a paid employee or consultant writing the code" | **Excluded.** This is a paid client deliverable |
| **Cloudflare R2** | 10 GB / 1M writes / 10M reads per month, no egress fees | **Excluded (D12).** Multiple reports say enabling it prompts for a payment method, and at least one user reported an unexpected $5 charge — not worth the risk given "no card anywhere" |
| **Backblaze B2** | 10 GB free, S3-compatible API, free egress up to 3x stored data/month | **In use** (files). Confirmed no card required at signup — direct swap-in for R2 behind the same `StorageService` interface |
| **Render free web service** | 750 instance-hours/month, no card | **In use** (backend). Spins down after ~15 min idle, ~30–60s cold start on wake, blocks outbound SMTP ports 25/465/587. §2.4 explains why this doesn't delay notifications |
| **Koyeb** | Was the best "no card, no sleep" candidate | **Checked and now excluded** — removed its card-free tier in February 2026; now requires a card with a $29 pre-authorisation hold |
| **Google Cloud Run** | 2M requests, 180,000 vCPU-seconds/month free | **Excluded (D12)** — needs a Google Cloud billing account (card). Kept in §7 as a later option |
| **Oracle Always Free VM** | Real always-on server, ARM, 2 OCPU/12GB as of mid-2026 | **Excluded (D12)** — needs a card. Kept in §7 as a later option |
| **Neon Free** (DB) | 0.5 GB storage, 100 compute-hours/month, scale-to-zero after 5 min, no card | **In use.** Exceeding limits suspends compute, does not delete data |
| **Supabase Free** | 500 MB DB, 1 GB files | **Excluded** — whole project pauses after a week of inactivity, unsuitable for production |
| **Resend Free** | 3,000/month, 100/day | Candidate email provider, no card typically required, needs domain verification (D11) |
| **Brevo Free** | 300/day, unlimited contacts | Candidate email provider, no card typically required |
| **SendGrid** | No permanent free plan for new accounts | **Excluded** |

**"Genuinely free, no card, always awake" does not currently exist** among the options checked. Render is the best fit for "free + no card," and §2.4's design removes the part of the sleep behaviour that would otherwise matter.

**Email math:** a completed workflow with N approval steps sends roughly N+2 emails (one per step reached, plus Creator and CFO on completion/rejection). Resend's 100/day and Brevo's 300/day translate to roughly 40–60 completed multi-step workflows per day before hitting the cap — see `decisions.md` D14 for the full capacity envelope against ~50 users.

### 3.1 Hosting profile (single profile — no more A/B/C)

Cloudflare Workers static assets (web) + Render free (API, Docker) + Neon (DB) + Backblaze B2 (files) + Brevo or Resend (email) + Cloudflare Worker cron (retry tick, ~every 15–30 min) + GitHub Actions (CI, nightly backup); deploys via Render's and Cloudflare's git integrations.

Because the API is a plain Docker container configured only by environment variables, moving off Render later (to Cloud Run, Koyeb, Oracle, or a paid Render plan) is a redeploy, not a rewrite — see §7.

---

## 4. Domain model and engine rules

### 4.1 Tables (Drizzle migrations; `uuid` primary keys, all timestamps `timestamptz` in UTC)

| Table | Key columns | Notes |
|---|---|---|
| `roles` | `id`, `name` (unique), `permission` (`ADMIN`\|`CREATOR`\|`APPROVER`\|`CFO`, mandatory), `is_system`, `is_active` | Admin can create any number of custom-**named** roles, but each must declare one of the four permissions (**D3**). Seed the four base roles |
| `employees` | `id`, `employee_code` (unique, optional display field), `name`, `email` (unique, **the login identifier — D4**), `role_id`, `password_hash`, `is_active`, `must_set_password` | Never deleted, only deactivated. Partial unique index: **only one active CFO** |
| `sessions` | `id`, `employee_id`, `token_hash`, `expires_at`, `revoked_at`, `ip`, `user_agent` | Store a hash of the token, never the token |
| `password_tokens` | `employee_id`, `token_hash`, `purpose` (set/reset), `expires_at`, `used_at` | |
| `companies` | `id`, `name` (unique), `code` (nullable, unique), `status` | Index on `lower(name)` and `lower(code)` for prefix search |
| `company_default_approvers` | `company_id`, `employee_id`, `position` | Unique `(company_id, employee_id)`. **`position` may repeat — a repeated value is a parallel group (D1).** No uniqueness constraint on `(company_id, position)` |
| `workflows` | `id`, `title`, `file_key`, `file_name`, `file_mime`, `file_size`, `file_sha256`, `company_id`, `created_by`, `status`, `current_position`, `chain_customised`, `submitted_at`, `updated_at`, `version`, `invoice_number`, `vendor_name`, `invoice_date`, `amount`, `currency`, `notes` | `status` ∈ `PENDING_APPROVER`, `PENDING_CFO`, `COMPLETED`, `REJECTED`. The invoice columns are all nullable (**D6**, defaults proposed in `decisions.md`, confirm exact list before Phase 3) |
| `workflow_steps` | `id`, `workflow_id`, `position`, `employee_id`, `employee_name`, `employee_email`, `is_cfo`, `status` (`WAITING`,`PENDING`,`APPROVED`,`REJECTED`,`SKIPPED`), `decided_at`, `remarks` | **The snapshot.** Name/email copied at submit so history stays readable. Unique `(workflow_id, employee_id)`; `position` may repeat (parallel group). The CFO row's position is always the maximum in the chain and is always a group of one |
| `audit_events` | `id`, `workflow_id`, `actor_id`, `event_type`, `payload jsonb`, `created_at` | **Append-only**; a DB trigger rejects UPDATE/DELETE |
| `notification_outbox` | `id`, `workflow_id`, `to_email`, `template`, `payload`, `status`, `attempts`, `next_attempt_at`, `sent_at`, `dedupe_key` (unique), `last_error` | Written in the same transaction as the decision; sent synchronously immediately after commit (§2.4), retried by the tick only on failure |

### 4.2 Roles and visibility (enforced in the API, never only in the UI)

| Actor | Can see | Can do |
|---|---|---|
| Admin | Everything (read-only on workflows) | Masters CRUD, dashboard, drill-down, D9 reassign |
| Creator | Their own workflows, any status | Upload, choose company, add/remove/reorder this document's chain (CFO exempt), submit |
| Approver / CFO | A workflow only once **their step has been reached** (`position ≤ current_position`) or already decided | Approve/Reject **only while their own step is `PENDING`** |

File downloads follow the same rule: the API issues a short-lived signed URL only after this check.

### 4.3 Approver eligibility (D3)
Both the Company Master's default-approver picker and the Creator's per-document "add approver" search **only return employees whose role has `permission = APPROVER`**. Creator-permission employees are never returned, so a Creator cannot end up in their own or anyone else's chain — self-approval is structurally impossible, not just a UI check. The CFO slot is filled automatically from the single active `permission = CFO` employee and never appears in the searchable picker.

### 4.4 Invoice fields (D6 — confirm the exact list before Phase 3)
Proposed default: `invoice_number`, `vendor_name`, `invoice_date`, `amount` (numeric(14,2)), `currency` (default `INR`), `notes` — all optional, so a non-invoice document just leaves them blank. Searchable/filterable on the Admin Dashboard alongside the existing columns.

### 4.5 Parallel and sequential steps, precisely (D1)
`position` (think of it as a **step number**) is not required to be unique. Two or more approvers sharing a position form a **parallel group** at that step; a chain that never repeats a number is purely sequential. Whoever builds the chain — Admin for company defaults, Creator for a single document — decides sequential-vs-parallel implicitly, by whether they give two approvers the same number or different ones. No separate mode flag is needed. The CFO's position is always the chain's highest number and is always a group of exactly one.

### 4.6 Notification matrix (final)

| Event | Recipients |
|---|---|
| Submitted | All approvers at the first step (one or more, if the first step is a parallel group) |
| A step's group fully approves | All approvers at the next step (or the CFO) |
| CFO approves | Creator, **CFO** |
| Any rejection, at any step | Creator, **CFO**, with the rejector's name and reason |

Emails carry a link to the review page and **never the document itself**, and there is no approve-from-email action (a forwarded email would otherwise let someone else act on a person's behalf).

### 4.7 Chain validation (submit time)
Company is Active · file passes the size/type rule in force (URS leaves this formally open — treat "PDF/DOCX ≤10MB" as the working default; confirm) · **at least 2 non-CFO approvers** in the final chain, whether default or Creator-customised (this extends beyond URS's company-level minimum, since Creators can now remove approvers too — flagged as an assumption in `decisions.md`, not yet confirmed) · no duplicate employee in the chain · Creator cannot appear in their own chain (structurally impossible per §4.3, but still assert it) · CFO appended automatically as the current single active CFO, always last, always alone · everything written as a snapshot into `workflow_steps`.

### 4.8 State machine and concurrency (the part that must not be wrong)
Every decision runs in **one transaction**:

1. `SELECT … FROM workflows WHERE id = $1 FOR UPDATE` (serialises concurrent approvers, including two members of the same parallel group acting at the same instant).
2. Assert: workflow is `PENDING_*`; the caller has a step at `current_position` with status `PENDING`.
3. **Reject:** remarks required (trimmed, non-empty) → this step-row `REJECTED`; every other still-open row in the whole workflow `SKIPPED`; workflow `REJECTED`; enqueue rejection emails to Creator + CFO (§4.6); write audit event.
4. **Approve:** this step-row `APPROVED`. If **every** row sharing this position is now `APPROVED` → advance `current_position` to the next distinct position, set that position's row(s) to `PENDING`, status `PENDING_APPROVER` or `PENDING_CFO` (if the next position is the CFO), enqueue "your turn" emails for **all** rows at the new position. If this was the CFO's position → status `COMPLETED`, enqueue emails to Creator + CFO. If other rows in the current group are still `PENDING` → no advance, no new emails.
5. Insert audit event; commit; **then synchronously attempt email delivery for every outbox row just inserted** (§2.4). Failures are left `pending`/`failed` for the tick to retry.

A second click or replay returns **409** with the current state. Terminal states are immutable.

### 4.9 API surface (REST, JSON, zod-validated, versioned under `/v1`)
`auth`: login (by email), logout, me, set-password, forgot/reset, change-password · `roles`, `employees`, `companies` CRUD · `companies/search?q=` (Active only, prefix match on name **or** code, case-insensitive, escaping LIKE wildcards) · `employees/search?q=` (name prefix only, restricted to `permission = APPROVER` per §4.3) · `uploads/presign` · `workflows` (create, list-mine, detail + audit, admin list with filters/pagination) · `approvals` (pending, history, decide) · `internal/tick` (secret-protected, retry only).

---

## 5. Phases

Relative size: **S** ≈ days, **M** ≈ 1–2 weeks, **L** ≈ 2–3 weeks for one developer working with Claude Code.

**Standing rules for every Claude Code prompt** (also in `CLAUDE.md`): read `CLAUDE.md`, `docs/URS.md`, `docs/plan.md`, `docs/decisions.md` first · do not assume: if anything is ambiguous or a decision is still OPEN in `decisions.md`, list the questions and stop · verify library APIs and versions against official docs before installing · propose a plan and wait for approval before writing code · small commits, tests for every rule · never edit `docs/URS.md`.

---

### Phase 0 — Foundations (S)
**Goal:** repo ready. No product code. (Decisions D1–D6, D12–D13 are already answered — this phase just needs the repo to exist and the reference docs placed in it.)

**Prompt for Claude Code**
~~~text
Create the repository skeleton for the DocFlow project. Do not write product code yet.
1. Initialise a pnpm workspace monorepo with apps/web, apps/api, packages/shared, infra/cron-worker and docs/ as described in docs/plan.md section 2.5.
2. Confirm docs/URS.md, docs/plan.md, docs/decisions.md and the root CLAUDE.md are present and readable. If any are missing, stop and tell me rather than inventing their contents.
3. Add .gitignore, .editorconfig, a root README with a 10-line project summary, and an .env.example placeholder (no real secrets).
Then list any questions you have about the plan or decisions files. Do not proceed beyond the skeleton.
~~~
**Gate:** repo exists with all four reference files readable.

---

### Phase 1 — Walking skeleton, deployed (M)
**Goal:** a "hello world" web app talking to a "hello world" API and a real database, **deployed to the real free hosts** with CI, on Cloudflare Workers and Render specifically.

**Prompt for Claude Code**
~~~text
Read CLAUDE.md and docs/plan.md sections 2 and 3. Propose a plan, wait for my approval, then implement Phase 1:
- apps/api: Fastify + TypeScript strict, env validation with zod (fail fast on missing vars), pino logging, GET /healthz and GET /v1/ping, Drizzle configured against Neon via a standard TCP driver and the pooled connection string, first migration creating the `roles` table with its `permission` column, graceful shutdown. Write a Dockerfile (multi-stage, non-root, small image) and a docker-compose for local Postgres.
- apps/web: Vite + React + TypeScript, Tailwind, shadcn/ui, React Router, TanStack Query; one page that calls /v1/ping and shows the result.
- packages/shared: a zod schema and enum imported by both apps to prove the sharing works.
- CI (GitHub Actions): install, typecheck, lint, test, build on every PR. No deploy workflows: Render and Cloudflare Workers Builds deploy from their own git integrations on push to main (D15). Do not put secrets in the repo.
- infra/cron-worker: a Cloudflare Worker with a cron trigger (every ~20 minutes) that POSTs to /internal/tick with a shared secret header. The endpoint may just return 200 for now.
- Set the session cookie to SameSite=None; Secure for now, since web and api are on different default domains (*.workers.dev, *.onrender.com) until a real domain exists.
Verify every library/service setting against its current official docs. Tell me exactly which manual steps I must do in each dashboard. Measure and report the actual cold-start delay on Render after 15+ minutes idle. Update CLAUDE.md with the real commands you created.
~~~
**Gate:** the web app loads, calls the API, data comes from Neon; a PR triggers CI; a merge deploys both; you have observed and written down the real Render cold-start delay.

---

### Phase 2 — Auth, RBAC and the three masters (L)
**Goal:** Admin can sign in (by email) and manage Roles, Employees and Companies (with default approver chains, parallel groups allowed). Figma screens 01 and 03 plus the undesigned Employee/Role/Company-form screens.

**Prompt for Claude Code**
~~~text
Read CLAUDE.md, docs/plan.md sections 4.1-4.3 and this phase, and docs/decisions.md. Propose a plan first, then implement Phase 2.
Backend: migrations for roles (with mandatory permission column), employees (email is the login identifier, employee_code is a separate optional field), sessions, password_tokens, companies, company_default_approvers (position may repeat) exactly as plan section 4.1 (only one active CFO enforced by a partial unique index). Session auth with argon2 hashing, HttpOnly Secure cookie, login by email, rate limiting, logout, me, change-password, set-password/forgot-password by one-time token (emailing can be a stub that logs the link until Phase 5). Authorization middleware based on each role's permission field. CRUD endpoints for roles/employees/companies; deactivate instead of delete; company cannot be saved with fewer than 2 default approvers; CFO auto-filled and read-only; the approver picker on Company Master only returns employees with permission=APPROVER.
Frontend: Login (Figma node 3:2), app shell/sidebar per role, Admin Masters (Figma node 4:2) with tabs for Company, Employee and Role masters, Add/Edit Company form with an ordered approver picker that allows assigning the SAME position number to multiple approvers (a parallel group), drag to reorder, validates the minimum and duplicate-employee rules. Employee and Role forms (Role form requires picking a permission). Where Figma has no design, follow the same tokens/components and tell me what you invented.
Tests: unit tests for every validation rule; integration tests for auth, permission-based guards, "second active CFO is rejected", and "a Creator-permission employee never appears in the approver search."
~~~
**Gate:** Admin can log in by email, create roles/employees/companies including a parallel-group default chain, cannot save a company with 1 approver or a second active CFO; unauthorized roles get 403 on every admin endpoint (tested); a Creator never shows up in an approver search (tested).

---

### Phase 3 — Creator flow: upload and submit (L)
**Goal:** Creator uploads a file, finds a company by type-ahead, sees the auto-populated chain, adds/removes/reorders approvers for this document (CFO exempt), resets it, submits — with invoice fields. Figma screens 04 and 05.
**Needs:** the exact invoice field list confirmed (D6), the file type/size rule confirmed.

**Prompt for Claude Code**
~~~text
Read CLAUDE.md, docs/plan.md sections 4.4, 4.7 and this phase, docs/decisions.md. Stop and ask if the invoice field list or file rules are still unconfirmed. Propose a plan first.
Backend: a StorageService interface implemented against Backblaze B2's S3-compatible API (private bucket, presigned PUT for upload, presigned GET issued only after the visibility check in plan 4.2, short expiry). POST /v1/uploads/presign validates declared size/type; on workflow creation, verify the object exists, size and file signature match, store SHA-256. Company search endpoint (Active only, case-insensitive prefix on name OR code, escape LIKE wildcards). Employee search restricted to permission=APPROVER (name prefix only). POST /v1/workflows accepts the invoice fields from plan 4.4, validates the chain per plan 4.7 (including the 2-non-CFO-approver minimum on the CUSTOMISED chain, not just the company default), allows the Creator to remove any non-CFO approver, and writes workflows + workflow_steps snapshot + audit event in one transaction. GET my-submissions with pagination.
Frontend: New Submission (Figma node 4:106) with the invoice fields added to the form: drop/browse upload with progress, debounced type-ahead company search, chain list auto-populated in default order (showing parallel groups clearly when they occur), locked CFO row, add approver via employee search, drag-and-drop reorder, a remove control on each non-CFO row, "Reset to Company Default", submit. My Submissions (Figma node 5:2) plus a detail view showing the timeline. Handle upload failure, wrong type/size, double-submit, and the case where removing approvers would drop the chain below 2.
Tests: chain-validation unit tests (including parallel groups and the new minimum-on-customised-chain rule); an integration test proving a Creator's customisation never changes company_default_approvers; a test that a snapshot is unaffected by later Company Master edits.
~~~
**Gate:** the end-to-end Creator path works against real Backblaze B2 and Neon; a Creator can remove a default approver down to the 2-minimum but not below it; all resolved URS/decisions behaviours have a passing test.

---

### Phase 4 — Approval engine and reviewer screens (L)
**Goal:** the core: sequential AND parallel approval with a bulletproof state machine and visible audit trail. Figma screens 06, 07, 08, 09. **This is the highest-risk phase; review it line by line.**

**Prompt for Claude Code**
~~~text
Read CLAUDE.md, docs/plan.md sections 4.5-4.8 and this phase, docs/decisions.md. Propose a plan first, then implement.
Implement the decision endpoint exactly as plan 4.8: one transaction, SELECT ... FOR UPDATE on the workflow row, all assertions, reject requires non-empty remarks and skips every other open row and notifies Creator+CFO, approve only advances the position when EVERY row sharing that position is approved, CFO approval completes and notifies Creator+CFO. Insert notification_outbox rows and audit_events inside the same transaction, then attempt synchronous delivery immediately after commit (this is delivery, not just Phase 5's job — wire a minimal EmailProvider stub now if Phase 5 hasn't run yet, real providers come in Phase 5). Enforce the visibility rules in plan 4.2 on every read endpoint and on file URLs. Add an Admin "reassign pending step" action, fully audit-logged (D9). Add a DB trigger that blocks UPDATE/DELETE on audit_events.
Frontend: Approver My Approvals (Figma node 6:2), Review Document with accumulated audit trail and decision panel (5:86), CFO Review (6:84), CFO Dashboard (6:158), plus History pages. The trail must show the ACTUAL chain used for that document, including parallel groups and whether it was customised.
Tests (write these first): full happy path with a mix of sequential and parallel steps; rejection at each position, including mid-parallel-group; TWO approvers in the SAME parallel group deciding at the same instant (real parallel transactions — assert exactly one advance, no duplicate outbox rows, and that the workflow does not advance until BOTH have approved); replayed approve returns 409; an approver whose turn has not come gets 404/403 on the workflow and its file URL; deactivated approver cannot act; terminal states immutable; snapshot unaffected by master data changes.
~~~
**Gate:** the concurrency tests (including the same-group-same-instant case) pass in CI; you manually walk the URS §10 appendix flow end to end with at least one parallel step.

---

### Phase 5 — Notifications (M)
**Goal:** emails go out reliably, exactly once, with the synchronous-send-plus-safety-net-tick pattern from §2.4.
**Needs:** a verified sender domain (D11).

**Prompt for Claude Code**
~~~text
Read CLAUDE.md, docs/plan.md sections 2.4, 4.6, 4.8 and this phase, docs/decisions.md. Stop and ask if the domain isn't ready yet. Propose a plan first.
Implement an EmailProvider interface with a Brevo adapter and a Resend adapter (plain HTTPS, no SMTP; choose via env var), plus a console adapter for local dev. Templates (HTML + plain text) for: your-turn, completed, rejected (with rejector name and reason), set/reset password. IMPORTANT: do not build a "queue everything and let the tick send it" design — the primary send path is synchronous, immediately after commit, inside the request that caused the event (plan section 2.4, CLAUDE.md invariant 10). POST /internal/tick only picks up rows still pending/failed and retries with exponential backoff up to a maximum attempt count, using FOR UPDATE SKIP LOCKED so concurrent ticks never double-send. A unique dedupe_key prevents double sends on either path. Recipients per event come from the config object matching plan section 4.6 (Creator+CFO on rejection and completion).
Tests: outbox row created exactly once per event; the synchronous path succeeds without needing the tick in the common case; provider failure then a later tick retry succeeds; two concurrent ticks never double-send; rejection and completion recipients match plan 4.6. Give me a manual test checklist for a real inbox, including SPF/DKIM checks.
~~~
**Gate:** all notification triggers observed in real inboxes with no delay in the common case; a simulated provider outage recovers on the next tick without duplicates.

---

### Phase 6 — Admin dashboard and audit views (M)
**Goal:** Figma screen 02 plus the drill-down the URS requires.
**Needs:** D7 (Export/stat cards) confirmed.

**Prompt for Claude Code**
~~~text
Read CLAUDE.md, docs/plan.md and this phase, docs/decisions.md (D7). Propose a plan first.
Admin Dashboard (Figma node 3:21): server-side paginated, sortable table (Document, Company, Created By, Status, Submitted, Last Updated, plus the invoice columns where present); filters for Status (including "Pending at position N" and "Pending CFO"), Company, Created By, submitted date range, all combinable and reflected in the URL; row click opens the full audit trail page (who, when, remarks, order, whether parallel groups were involved, and whether the chain was customised), readable after completion/rejection. Implement Export and the stat cards ONLY as decisions.md D7 says once confirmed. Add DB indexes justified by the actual filter queries and show me the EXPLAIN output.
Tests: filter combinations, pagination boundaries, that only Admin can access these endpoints.
~~~
**Gate:** every filter works and is covered by a test.

---

### Phase 7 — Hardening and acceptance (M)
**Goal:** safe to show the client and put real data in.

**Prompt for Claude Code**
~~~text
Read CLAUDE.md and docs/plan.md sections 4, 6 and this phase. Do a security and quality pass and report findings before fixing anything.
Review: authorization on every endpoint (write a table of endpoint x permission x expected result and test it), session fixation/expiry/revocation, CSRF posture, CORS restricted to the exact web origin, security headers, rate limits on login/forgot-password/uploads, input validation, presigned URL expiry and scope, secrets handling, error messages that leak nothing, dependency audit. Add: Playwright end-to-end test of the whole approval flow including a parallel step; a script that seeds realistic demo data; accessibility check on every screen; responsive layouts down to phone width (URS asks for this even though Figma is desktop-only); loading/empty/error states everywhere; structured logs with a request id and no PII or tokens. Add the nightly backup workflow from plan section 6 and a documented, TESTED restore procedure.
~~~
**Gate:** the endpoint×permission matrix passes; a restore drill succeeded; Playwright flow green in CI; client UAT script written from the URS appendix.

---

### Phase 8 — Go-live and handover (S–M)
**Goal:** production, monitored, documented, on the real domain.

**Prompt for Claude Code**
~~~text
Read CLAUDE.md and docs/plan.md sections 2.3, 6-8. Prepare go-live: point app.<domain> at Cloudflare Workers and api.<domain> at Render, switch the session cookie from SameSite=None to SameSite=Lax and retest login end to end, verify SPF/DKIM for the email domain. Separate production and staging configs (never share DB or secrets), production seed (Admin, the single CFO, system roles), a go-live checklist (DNS, budget/quota watch per plan section 6, backup job green, first-login/set-password emails tested), an operations runbook (how to deploy, roll back, restore, rotate secrets, replace the CFO, reassign a stuck step, what to do when the email or storage quota is hit), and short admin/creator/approver user guides. Do not change product behaviour in this phase.
~~~
**Gate:** client sign-off; runbook reviewed; you can restore and redeploy without Claude Code.

---

## 6. Environments, CI/CD, backups, cost guardrails

- **Environments:** `local` (docker-compose Postgres, console email adapter), `staging` (own Neon project/branch, own Backblaze bucket, email restricted to allow-listed test addresses), `production`. Never share secrets or databases between them.
- **Secrets:** GitHub Actions secrets and each host's secret store; `.env.example` lists names only.
- **CI/CD:** PR → typecheck, lint, tests (Postgres service container), build. Merge to `main` → Render and Cloudflare deploy automatically via their git integrations. **As built in Phase 1 there is one environment and no staging** (D15); add a staging service/branch before real data goes in.
- **Migrations:** explicit deploy step, backwards-compatible, never edited after merge.
- **Backups:** nightly `pg_dump` from GitHub Actions into a second Backblaze B2 bucket (or separate path), keep 14 daily + 8 weekly, **test a restore before go-live** — this is the client's audit data and Neon's free-tier point-in-time window is short.
- **Cost guardrails (no card anywhere to watch a bill on, so watch usage instead):** Render's 750 free instance-hours/month (should stay well under it given §2.4's design); Neon's 100 compute-hours/month and 0.5 GB storage; Backblaze B2's 10 GB storage cap; Brevo/Resend's daily send cap; GitHub Actions' free minutes allowance (**VERIFY AT BUILD** before scheduling anything frequent).
- **Monitoring at $0:** `/healthz`, structured pino logs, an uptime check. Track outbox rows stuck `pending`/`failed`; alert on any older than an hour.

---

## 7. Scaling path (what breaks first, what it costs, and what needs a card)

| When this happens | Fix | Needs a card? |
|---|---|---|
| Cold starts become a real problem for users | Render Starter, ~$7/month, removes sleep entirely | Yes, but same host/pipeline — no rewrite |
| Client becomes willing to put a card down for always-on hosting | Move the API to Google Cloud Run or (now paid) Koyeb | Yes — redeploy, not a rewrite, since the API is just a container |
| Files exceed Backblaze B2's 10 GB | B2 paid storage, ~$0.006/GB-month | Yes, at that point |
| Emails exceed 100–300/day | Upgrade Brevo/Resend tier | Yes |
| Neon compute-hours or storage exhausted | Neon Launch (usage-based) | Yes |

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Free-tier terms change without notice — Koyeb removed its card-free tier mid-way through writing this very plan | Everything portable behind interfaces; re-verify §3 before Phase 1 and again before go-live |
| Approval stuck when a person leaves | D9 reassign action + runbook |
| Email lands in spam / provider outage | Verified domain, outbox retries, admin "resend" is an easy later addition |
| Data loss on free DB | Nightly tested backups (§6) |
| Uploading malware | v1 accepts size/type/signature checks only; document as a known limitation; raise with client |
| Cross-site cookie fragility before the domain exists | `SameSite=None` works but is weaker; fix at go-live, not after (§2.3, §8 Phase) |
| Sleeping backend surprises a user | §2.4's design means it never delays an email; it only ever delays a first page load — set that expectation with the client |
| The 2-approver-minimum-on-customised-chains rule is my assumption, not the client's | Confirm before Phase 3 (see `decisions.md`) |

---

## 9. Suggested improvements (optional, none assumed)

1. Admin "resend notification" button and an admin view of failed emails.
2. Store the SHA-256 of each uploaded file in the audit trail as tamper evidence (cheap, already in the schema).
3. Reminder emails via the existing tick (D10).
4. A read-only "share link" to the audit trail for auditors (later).
5. A one-line "what changed" note when the Creator customises the chain, shown to approvers.

---

## 10. Sources (checked 28–29 Sep 2026; pricing pages change often — re-verify before go-live)

- Vercel Hobby plan and Fair Use Guidelines: vercel.com/docs/plans/hobby, vercel.com/docs/limits/fair-use-guidelines
- Cloudflare Pages/Workers no-card, commercial-use-allowed: freetiers.com/directory/cloudflare-pages; community.cloudflare.com "Is Cloudflare Pages, Workers free plan free for commercial use?"; snapdeploy.dev "Free Cloud Deployment Platforms Compared (Sep 2026)"
- Cloudflare R2 pricing and payment-method reports: developers.cloudflare.com/r2/pricing; community.cloudflare.com threads on R2 requiring a payment method and an unexpected $5 charge
- Backblaze B2 no-card signup: backblaze.com/sign-up/b2-cloud-storage-backup-archive; freetier.co/directory/products/backblaze-b2-cloud-storage; stacksfree.com/tool/backblaze-b2
- Render free tier: render.com/docs/free (spin-down, SMTP ports blocked, ephemeral disk)
- Koyeb card requirement change (Feb 2026): koyeb.com/docs/faqs/pricing; snapdeploy.dev; flywp.com "9 Best Free Docker Hosting Platforms in 2026"
- Neon vs Supabase free plans: neon.com/guides/neon-vs-supabase-free-plan, neon.com/docs/introduction/auto-suspend
- Google Cloud Run pricing: cloud.google.com/run/pricing
- Oracle Always Free change: InfoQ, "Oracle Quietly Halves Free Tier Ampere A1 Compute Limits" (Jul 2026)
- Email free tiers: Brevo help center "What are the limits of the Free plan"; brevo.com/blog/best-email-api
- Claude Code memory (`CLAUDE.md`, `/init`): code.claude.com/docs/en/memory
