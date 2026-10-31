# DocFlow — Decisions Register

Answers given by the project owner on 29 Sep 2026 unless noted. This file overrides `URS.md` wherever the two disagree — the URS is the client's original document and is never edited; deviations from it are tracked here instead.

---

### D1 — Parallel vs sequential approvers
**Status: ANSWERED (29 Sep 2026).** Both must be supported, chosen per document (or per company default) by whoever builds the chain.

**Design:** `position` (renamed conceptually to **step number**, column name unchanged) is no longer required to be unique. Two or more approvers may be given the **same step number**, forming a parallel group at that step. A chain that never repeats a number is purely sequential; a chain with a repeated number has a parallel step at that point. This is decided implicitly by whoever assigns positions — Admin for `company_default_approvers`, Creator for a single document's `workflow_steps` — with no separate "mode" flag needed.

**Rule:** every approver in a step must approve before the workflow advances to the next step number. A rejection by **any** approver in the group ends the workflow immediately, exactly like a sequential rejection (URS §5.4's rule extends unchanged to groups). This reverses the URS's "positions must be unique" / "no two approvers act in parallel" clauses (§4.3, §6, §9) — flag this to the client as a confirmed scope change from v1 of the URS.

The CFO step is never part of a group: exactly one CFO, always the final step, own unique step number.

---

### D2 — Rejection/completion notification recipients
**Status: ANSWERED (29 Sep 2026).**

| Event | Recipients |
|---|---|
| Rejection (at any step) | Creator (URS, with rejector's name and reason) **and CFO** |
| Completion (CFO gives final approval) | Creator (URS) **and CFO** (confirmation copy) |

This is on top of the unchanged "your turn" notifications in URS §5.6. Recipients live in one config object (`packages/shared`) so this is a one-line change if it needs revisiting.

---

### D3 — Roles, self-approval, and who can be picked as an approver
**Status: ANSWERED (29 Sep 2026).** Creator and Approver are distinct roles; the Figma screens' reuse of "R. Shah" as both a Creator and an approver is sample-data noise, not a requirement.

**Design (this deviates from URS §4.1, which says Role Master carries no restriction — the client should be told this closes URS open question §8.1's first bullet):**
- `roles` gets a mandatory `permission` field, one of `ADMIN`, `CREATOR`, `APPROVER`, `CFO`. Admin can still create any number of custom-**named** roles (e.g. "Regional Approver"), but each one must declare which of the four permissions it carries — Role Master keeps its labelling flexibility, but is no longer permission-free.
- The Company Master default-approver picker and the Creator's per-document "add approver" search **only return employees whose role has `permission = APPROVER`**.
- Because Creator-permission employees are never returned by that search, a Creator cannot end up in their own (or anyone else's) chain. Self-approval is prevented structurally, not just by a UI check.
- The CFO slot is filled automatically from the single active `permission = CFO` employee; it never appears in the searchable picker because it isn't optional.

---

### D4 — Login identifier
**Status: ANSWERED (29 Sep 2026).** Log in with **email**, not employee Id (overrides my earlier default and the URS §4.2 reading; the Figma login screen's "Email" label wins). `employees.email` is unique and is the auth identifier. Keep `employee_code` as a separate optional display/search field if useful, but it does not gate login.

---

### D3(d) / chain editing — Remove and reorder default approvers
**Status: ANSWERED (29 Sep 2026).** The Creator may **add, remove, and reorder** approvers for their document, including removing ones that came from the Company default — not just add and reorder as the URS text says. CFO is exempt from all of this: always present, always last, never movable, never removable.

**My assumption, not yet confirmed — flag before Phase 3:** the document's customised chain must still end up with **at least 2 non-CFO approvers** before it can be submitted, mirroring the Company Master's own minimum. Without this a Creator could empty the chain down to "CFO only," which seems unlikely to be intended. Tell me if that's wrong.

---

### D6 — Invoice-specific fields
**Status: ANSWERED (yes) — exact field list is my proposed default, please confirm/edit.**

Proposed columns on `workflows`, all optional (a non-invoice document just leaves them blank):
- `invoice_number` (text)
- `vendor_name` (text)
- `invoice_date` (date)
- `amount` (numeric(14,2))
- `currency` (text, default `INR`)
- `notes` (text, free-form)

These become searchable/filterable columns on the Admin Dashboard alongside the existing ones. If the client needs a PO number, tax/GST amount, cost centre, or department, add them the same way.

---

### D7 — Dashboard Export button and stat cards
**Status: ANSWERED (owner, 7 Oct 2026): keep the four count cards, no Export in v1.** Original note: URS §5.8/§9 puts exports and summary statistics out of scope for v1; Figma's Admin Dashboard shows both. I still recommend **dropping Export** and keeping the four simple count cards (they're cheap and non-analytical). Confirm before Phase 6.

---

### D8 — Resubmission after rejection
**Status: unanswered, default stands.** v1: no edit/resubmit; a rejected document must be uploaded fresh (URS §9). Revisit later if the client wants it.

### D9 — Stuck workflows (approver leaves, CFO replaced)
**Status: unanswered, default stands.** Add an Admin "reassign pending step" action, fully audit-logged. Out-of-office delegation stays out of v1.

### D10 — SLA/reminder emails
**Status: unanswered, default stands.** Deferred; the tick mechanism (§2.4 of plan.md) makes adding this cheap later.

---

### D11 — Domain
**Status: PARTIALLY ANSWERED.** No domain yet; one will be bought before go-live. Until then:
- Cookies: use `SameSite=None; Secure` between the default `*.workers.dev` (frontend) and `*.onrender.com` (backend) hosts — this works over HTTPS but is weaker and more fragile than a same-site setup (some browsers restrict cross-site cookies further over time).
- Once the domain exists, point `app.<domain>` at the Cloudflare Worker `docflow` (custom domain) and `api.<domain>` at Render (both support free custom domains/CNAMEs), switch the cookie to `SameSite=Lax`, and re-verify login still works.
- Email deliverability (Phase 5) also needs the domain, for SPF/DKIM records with Brevo/Resend.
**Not a blocker for Phases 0–4.** Blocks Phase 5 (real email) and should be done before go-live (Phase 8).

---

### D12 — Card on file
**Status: ANSWERED (29 Sep 2026).** **No card anywhere.** This explicitly rules out Cloudflare R2 (confirmed to prompt for a payment method to enable) and Google Cloud Run (requires a GCP billing account). See plan.md §3 for the full re-worked hosting profile that fits this constraint.

### D13 — Language
**Status: ANSWERED.** TypeScript end-to-end, confirmed.

### D14 — Scale
**Status: PARTIALLY ANSWERED.** ~50 users. Document volume: "as much as possible for free." Given the chosen free tiers (see plan.md §3), the realistic envelope is:
- **Files:** Backblaze B2's 10 GB free tier holds roughly 1,000 documents at the Figma-implied 10 MB cap, likely several times that in practice since most uploads will be smaller.
- **Database:** Neon's 0.5 GB free tier holds workflow/audit metadata (a few KB per workflow) for tens of thousands of workflows — storage here is not the limiting factor.
- **Email:** Brevo's 300/day (or Resend's 100/day) supports roughly 40–60 completed multi-approver workflows per day before hitting the cap, comfortably above what 50 users are likely to generate.
So "as many as possible for free" resolves to **file storage as the real ceiling**, at roughly 1,000+ documents before Backblaze's free tier needs topping up (still cardless to start, cost only kicks in past 10 GB).

---

### Phase 0 follow-ups (owner, confirmed after the skeleton was built)
- **D2 (final):** the CFO receives the completion confirmation email even when they are the approving actor. Not to be revisited.
- **Status label for parallel groups:** use "Pending Approver (Position N)" regardless of how many approvers share position N; never list names in the label.
- **URS "Id" field:** becomes the optional `employee_code` field (login is by email, per D4).
- **Still unconfirmed, carried forward (do not block on them):** D6 exact invoice field list and the 2-non-CFO-approver minimum on customised chains (needed by Phase 3); file type/size rule (Phase 3); D7 Export/stat cards (Phase 6).

---

### D15 — Hosting as built (Phase 1, 5 Oct 2026)
**Status: ANSWERED (owner set up the accounts; reconciled against current provider docs).** Where this differs from earlier plan text, this entry wins.

- **Email provider: Brevo** (not Resend). `EMAIL_PROVIDER=brevo` is the default.
- **Frontend: Cloudflare Workers static assets, not Cloudflare Pages.** An assets-only Worker named `docflow`, with no Worker script. It is deployed by Workers Builds (Cloudflare's git integration) with root directory `apps/web`, build command `pnpm install && pnpm build`, and deploy command `npx wrangler deploy`. Config lives in `apps/web/wrangler.jsonc`, and its `name` must match the dashboard Worker name or the build fails. URL: `docflow.<subdomain>.workers.dev`.
  - `VITE_API_BASE_URL` must be a **build** variable (Settings → Build), because runtime variables aren't visible to `vite build`.
  - The build image defaults to pnpm 10, so the build variable `PNPM_VERSION=12.9.1` is required.
- **Cron worker:** a second Workers Builds project, `docflow-cron`, with root directory `infra/cron-worker`. It runs every **30** minutes (changed from 20 on 6 Oct 2026: measured on 6 Oct, a 20-minute tick kept Render awake permanently, because Render did not sleep after 18 min idle; that made the tick a de-facto keep-alive using ~744 of the 750 free hours a month), and `workers_dev` is off (cron only, no public URL). Its secret `TICK_SECRET` has the same value as the API's `TICK_SHARED_SECRET`.
- **API: Render free web service `docflow`.** Render can't see files outside a service's Root Directory, so the service builds from the **repo root**:
  - Root Directory: empty
  - Dockerfile Path: `./apps/api/Dockerfile`
  - Docker Build Context: `.`
  - Build Filters: `apps/api/**`, `packages/shared/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
  - Health check: `/healthz`
- **Migrations run on container start** (`node dist/migrate.js && node dist/server.js`) over `DATABASE_URL_DIRECT`, guarded by a Postgres advisory lock. The free tier has no Pre-Deploy Command.
- **No GitHub deploy workflows.** Both hosts deploy from their own git integrations on push to `main`, and GitHub Actions runs CI only (`.github/workflows/ci.yml`). Nightly backup (`backup.yml`) was added in Phase 7; see below.
- **Live URLs (5 Oct 2026):** web `https://docflow.harddik2002.workers.dev`, API `https://docflow-xayj.onrender.com`. Render suffixes subdomains that are already taken: `docflow.onrender.com` belongs to another account, so always copy the URL from the dashboard. Changing a Cloudflare build variable does not trigger a rebuild; push a commit or use "Retry build".
- **One environment, no staging yet.** plan.md §6 assumed staging plus a production approval gate. Add a separate Neon branch and Render service for staging before real data goes in (Phase 7/8).
- **Neon:** Singapore region (Render and Cloudflare regions are the owner's choice). The pooled string serves runtime queries and the direct string serves migrations.
- **Backblaze B2** endpoint `s3.eu-central-003.backblazeb2.com` (region `eu-central-003`), private bucket with a scoped key. Not used by code until Phase 3.

---

### D16 — First Admin and initial passwords (before real email)
**Status: ANSWERED (owner, 6 Oct 2026).**
- **First Admin:** created with the seed command `pnpm --filter @docflow/api seed:admin --email … --name "…"`. It prints a one-time set-password link to that terminal only.
- **Other employees:** when Admin adds an employee, the UI shows a one-time link to copy and send. Employee Master also has an "Invite link" / "Reset link" action on every active employee.
- **Link validity:** links last 72 hours and work once. Issuing a new link cancels the previous one.
- **No tokens in logs:** reset tokens never go into server logs.
- **Self-service reset** ("Forgot password?") waits for real email in Phase 5. Until then that page tells people to ask their administrator.

### D17 — Removing an approver who is in a default chain
**Status: ANSWERED (owner, 6 Oct 2026).** Deactivating an employee, or moving them to a role whose permission isn't APPROVER, is **blocked** while they sit in any company's default chain. The error names the companies, and Admin edits those chains first. This keeps every saved chain valid. In-flight workflows are unaffected either way, because they use a snapshot (invariant 2).

### D18 — Companies when no CFO exists
**Status: ANSWERED (owner, 6 Oct 2026).** A company can be saved while there is no active CFO, and the chain editor shows a "No active CFO yet" warning. Phase 3 must block submission until a CFO exists.

### D19 — Rules added during Phase 2 (my defaults; tell me if any are wrong)
**Status: PROPOSED by Claude Code, built and tested (6 Oct 2026).**
- **Fixed role permission:** a role's permission can't be changed after creation; create a new role instead. Changing it would silently change every holder's access and could break chains.
- **Role deactivation:** built-in roles can't be deactivated, and neither can a role that still has active employees.
- **Admin self-protection:** an Admin can't deactivate themself or remove their own Admin access. The last active Admin can't be removed.
- **Passwords:** at least **8** characters (owner, 6 Oct 2026; I had proposed 12), with no composition rules (NIST SP 800-63B minimum).
- **Sessions:** they last 12 hours (`SESSION_TTL_HOURS`). Changing your password signs out your other devices, and deactivation signs the person out immediately.
- **Login rate limit:** 5 attempts per minute per IP and email.
- **CSRF protection:** while the cookie is `SameSite=None`, every state-changing request must come from `WEB_ORIGIN` and be JSON. Otherwise it gets a 403.
- **Step numbers:** they are renumbered 1..n on save (1,1,3 becomes 1,1,2). Gaps carry no meaning.
- **Masters audit:** master-data changes are recorded in the server logs (actor and record IDs, no personal data) but not in `audit_events`, which stays workflow-scoped as in plan §4.1.

---

### Phase 3 decisions (owner, 7 Oct 2026)
- **D6 confirmed:** the invoice fields are invoice number, vendor name, invoice date, amount (numeric 14,2), currency (default `INR`) and notes, all optional. The owner may adjust the list later; adding a field is a migration plus one form field.
- **D20 (file rules):** PDF or DOCX, up to 10 MB. The rule is enforced in three places:
  - **The browser** checks first.
  - **The API** validates the declared type and size.
  - **The storage service** only accepts a PUT that matches the signed type and exact size. This was verified against B2.
  - **After upload**, the API also checks the file's real signature (`%PDF-` or zip), and deletes and rejects mismatches.
- **D3(d) minimum (confirmed):** a Creator may add, remove, reorder or make parallel steps for one document, but the submitted chain must keep **at least 2 approvers before the CFO**.
- **Document name:** the document is identified by its uploaded file name. There is no separate title field.
- **Known limitation:** files are not malware-scanned. Only the size, type and signature checks above are applied (plan §8). Raise this with the client.
- **Storage hygiene:** a file that is uploaded but never submitted stays in the bucket. Cleaning up abandoned uploads is a candidate job for the retry tick later. Uploads expire after 24 h for submission purposes.

### D21: Deleting records (owner, 7 Oct 2026)
**Status: ANSWERED.** The owner wants to remove junk and test entries, not just deactivate them.
- **Delete in the masters:** Employee, Company and Role Master have a **Delete** action, but the server only deletes records that **nothing refers to**:
  - **Employee:** never in a submitted document's chain, never submitted one, never acted on one, not in any company's default chain, and not yourself. Their sessions, password links and never-submitted uploads (including the stored files) go with them.
  - **Company:** no document ever submitted for it. Its default chain goes with it.
  - **Role:** custom, and held by nobody, active or inactive.
- **Anything with history** can still only be deactivated. The URS §6 rule and invariant 7 hold for every record that appears in an audit trail.
- **Test-data wipe:** a full wipe of test data (documents, their history and files, keeping the Admin and built-in roles) is a one-off operation. Claude runs it only on the owner's explicit request, before go-live. It is never an in-app feature.

### Phase 4 decisions (owner, 7 Oct 2026)
- **Confirm before deciding:** Approve and Reject each ask for confirmation in a dialog that repeats the remarks, because decisions are final.
- **D9 reassign:** the Admin "reassign pending step" API ships with Phase 4 and is fully tested and audited (`REASSIGNED` event with the old and new person and the reason). The Admin button arrives with the Phase 6 dashboard. Rules:
  - only an undecided step can move;
  - only to an active Approver who isn't already in the chain;
  - a CFO step only to the current active CFO.
- **Notifications before Phase 5:** every event writes its outbox rows (recipients per §4.6 / D2), but with no email provider configured the rows are marked `skipped`. Turning email on in Phase 5 does not flush a backlog of stale messages for old events. Logs record outbox ids and templates, never addresses.
- **Status label:** while a parallel step is partly approved, the document still shows "Pending Approver (Position N)" until everyone in that step has approved (owner's wording rule).

### Phase 6 notes (7 Oct 2026)
- **Admin Dashboard:**
  - **Filters:** status (including "pending at position N"), company, creator, submitted date range and search (document name, invoice number, vendor). All combine, and all live in the page URL.
  - **Behaviour:** sortable headers, read-only for Admin, and a click-through to the full audit trail.
  - **Layout:** below 1280 px the list switches to cards, so no column is ever cut off; the invoice column only appears on very wide screens.
- **D9 reassign UI:** a **Reassign** action sits on each undecided step of the Admin document page. A reason is required, and the change shows in the Activity log.
- **Indexes:** at 20,000 synthetic documents, every dashboard query ran in under 7 ms. The only one that scanned the whole table was the default "newest first" view, now served by an index on `(submitted_at, id)`: 6.9 ms → 0.1 ms. Search uses a contains-match and stays a sequential scan (≈6 ms at 20k rows); a trigram index is the upgrade path if the data ever grows much larger.

### D22 — The CFO sees every rejection (owner, 7 Oct 2026)
**Status: ANSWERED.** A rejection still ends the chain at once; later approvers are skipped (invariant 5). But the CFO must always be informed, whether a document is approved or rejected:
- **Visibility:** the CFO named in a document's chain can open it read-only, file included, once it is rejected, even if it never reached their step. Other skipped approvers still can't.
- **Dashboard:** the CFO dashboard has a **"Rejected before final approval"** tab, with a count, listing who rejected each document, at which position, their reason and the date.
- **Email:** rejection emails already go to the Creator and the CFO (D2). They are delivered once Phase 5 email is live.

### Phase 7 security fixes (7 Oct 2026)
Full findings, the permission matrix and known limitations: `docs/security.md`.
- **Client IP:** the API trusts exactly `TRUSTED_PROXY_HOPS` proxies (default 3). Measured live on Render on 6 Oct 2026: the socket is Render's router, then a Render internal hop, then Cloudflare's edge, then the client. A client-supplied `X-Forwarded-For` entry can no longer change `request.ip`. If Render's network path ever changes, re-measure before changing the value.
- **Login limits:** 5 per minute per IP+email, plus 20 per 15 minutes per email from any IP. Change-password: 5 per minute per user. Presign, submit and decide: 30 per minute per user.
  - Limits live in memory, so they reset when the free instance sleeps or redeploys. This is accepted for one instance.
- **Submitted files are locked:** on submit, the file is copied server-side to `documents/<workflowId>`, which no browser can ever get a write URL for. Size, type and SHA-256 are checked on that copy, and the upload copy is deleted. Documents submitted before this change keep their old `uploads/…` key.
- **Cleanup:** the cron tick deletes uploads that expired unsubmitted (file first, then row) and sessions that expired or were revoked over 30 days ago.
- **Session cookie:** renamed to `__Host-df_session`. Everyone is signed out once when this deploys. Signing in revokes the session the browser already held.
- **Web security headers:** generated at build time into `dist/_headers`, covering CSP, frame-ancestors none, nosniff, Referrer-Policy, Permissions-Policy and HSTS. `connect-src` is derived from `VITE_API_BASE_URL` plus the B2 origin (`STORAGE_ORIGIN` build variable, optional), so moving the API to the real domain (Phase 8) needs no header edit.
- **Supply chain:**
  - The Docker base image is pinned by digest and CI actions by commit SHA.
  - CI runs `pnpm audit --audit-level high`.
  - One unpatched dev-only advisory, braces via the shadcn CLI, is ignored with its reason in `pnpm-workspace.yaml`.

### Phase 7 tests and accessibility (8 Oct 2026)
- **Two colours darkened a shade for WCAG AA**, the only deviation from the Figma palette. The axe scan measured both just under the 4.5:1 minimum for small text:
  - muted text `#6b7280` → `#646b78` (4.39:1 → 4.87:1 on grey chips);
  - status-pill blue `#2f5fe8` → `#2a55d4` (4.44:1 → 5.2:1 on its pale blue background).

  The primary button colour is unchanged.
- **Local storage driver** (`STORAGE_DRIVER=local`): development and CI only, and refused when `NODE_ENV=production`. The API stores files on disk and serves them through signed, expiring URLs with the same exact-type and exact-size rule as B2. It exists so browser tests need no B2. Production still never passes file bytes through the API.
- **Demo data** (`seed:demo`):
  - **Contents:** 9 people, 3 companies (one with a parallel first step) and 7 documents covering every state, created through the real submit and decide code.
  - **Safety:** it refuses `NODE_ENV=production` and any database that already has employees, so it can't touch the live data.
  - **Sign-in:** every demo account uses the password `demo-password-1`.

### Phase 7 backups (8 Oct 2026)
How to restore: `docs/runbook-backup.md`.
- **Schedule:** nightly at 02:00 IST from GitHub Actions, plus a manual "Run workflow" button.
- **Method:** `pg_dump` with the Postgres 18 client (Neon runs 18.6), encrypted with GnuPG AES-256 using a passphrase only the owner holds, then uploaded to a separate private B2 bucket with the b2 CLI (pinned binary, checksum-verified).
- **Retention:** 14 daily and 8 weekly backups (lifecycle rules on `daily/` and `weekly/`). The owner enabled Object Lock in **compliance** mode for 14 days, so not even the account can delete a recent backup.
- **Every run is a restore drill:** it downloads the uploaded file, decrypts it, restores it into an empty Postgres 18, compares row counts per table, runs migrations and boots the API on the copy. The repository is public, so the log shows table names only, never counts.
- **Not covered:** the PDF files in `docflow-files` (open item for Phase 8).

### Test-data reset and live demo (owner, 8 Oct 2026)
- **Who runs it:** Claude runs `reset:data` on the owner's request only, never on its own initiative. It is a CLI, never an app feature (D21).
- **Before every reset,** a backup run must have just succeeded.
- **What it deletes:**
  - every document, with its steps, audit trail, notifications and stored files;
  - every company;
  - every custom role;
  - every employee except the Admins named with `--keep`.

  Only `admin@tridentlifeline.com` survives. Without `--confirm` it is a dry run that only counts.
- **The audit trail:** it is emptied with `TRUNCATE`, which the append-only trigger (invariant 7) does not block. This wipe is the only sanctioned way audit events are ever removed.
- **Live demo** (`seed:demo --live`):
  - **People:** the same people, companies and documents as the development demo, but no demo Admin, so the real Admin manages it.
  - **Password:** one random password for all demo accounts, printed once. The public `demo-password-1` never exists on the live site.
  - **Email:** demo notifications are marked skipped, so a future email provider never tries the undeliverable `@demo.docflow.test` addresses.
- **Plan:**
  1. Back up, reset, then load the live demo for the owner to try.
  2. Before go-live, back up and reset again, then enter the real data.

### D23 — Several roles per person (owner, 12 Oct 2026)
**Status: ANSWERED.** The owner asked for people who create documents in one chain and approve in another, and accepted all of Claude's proposals.
- **Combinations:**
  - A person holds one role, or one Creator-type role plus one Approver-type role.
  - Any role with the Admin or CFO permission, built-in or custom, is always someone's only role.
  - Two roles of the same kind can't be combined.
- **Exclusions:**
  - In Role Master, a Creator role can be marked "can't be combined with" Approver roles, and the other way round.
  - Exclusions are mutual: saving one on either role applies to both.
  - Saving an exclusion that people already break is refused, and the error names them.
- **Nobody approves their own document** (the owner's words: the same person must never be in the same chain twice under different roles):
  - The approver search never offers the person searching.
  - Submit refuses a chain containing its creator.
  - Admin reassign refuses to hand a step to the document's creator.
  - Choosing a company whose default chain includes the creator leaves them out of this document's chain, with a note. If fewer than 2 approvers remain, they add someone.
  - The company's saved chain is unchanged.
  - Nobody appears twice in one chain (already enforced).
- **Tabs:**
  - Someone with both roles sees New Submission, Pending Approvals, My Submissions, Approval History, and lands on New Submission.
  - Single-role people see what they saw before. The approver's History page is now titled "Approval History".
- **D17 still applies:** someone in a company's default chain can't lose their Approver role. They can lose their Creator role.
- **Filters and sort on every list**, done by the server:
  - **My Submissions:** status, company, submitted dates, search and sort.
  - **Approval History and CFO History:** my decision, document status, company, decided dates, search and sort.
  - **Pending lists and the CFO's "Rejected before final approval" tab:** company, search and sort.
  - **Details:** search covers the file name, invoice number and vendor, as on the Admin Dashboard. The Company filter lists only companies in that person's own list. The pending cards always count everything.
  - **Phones:** each list also has a "Sort by" menu, because there the table becomes cards without column headers.
- **Migration 0008:** everyone's existing role moves into the new `employee_roles` table, so the live site keeps working unchanged until roles are edited.
- **Demo data:**
  - **Cast:** 1 CFO, Rahul and Sara (Creator), Arjun, Dev and Lina (Approver), and Priya, Meera and Kabir (both).
  - **New documents:** three, submitted by the dual-role people, including Priya's Microtech document, where she is left out of her own chain.
  - **Live site:** loaded only when the owner asks, reusing the current demo password.

---

## DocFlow v2

### D24 — v2 scope and answers (owner, 20 Oct 2026)
**Status: ANSWERED.** Requirements: `docs/v2-brief.md`. Analysis and plan: `docs/v2-gap-analysis.md`. Reviewed flow: `docs/v2-workflow.md`. v2 replaces the v1 approval engine, data model and dashboards; the platform (sign-in, storage, backups, hosting, security) stays.
- **Data safety:** option 1. A final v1 backup plus a downloaded archive, then rebuild on the v2 schema at cut-over. The owner accepts losing the live v1 demo data. Build on a long-lived `v2` branch; the live site stays on v1 until a single cut-over, which ends with a new v2 demo data set.
- **No email at all in v2.** People sign in daily and work from their dashboards. This replaces the brief's notification rules: C1, Q57–Q59 and Phase V9 are dropped.
- **No workflow designer.** The owner wants to see the whole chain live, with timestamps, plus the per-product tables with day counts. The workflow is versioned configuration changed through code review (Q62).
- **Component table:**
  - **PO** is the buyer's purchase order: **PO Quantity** is what the buyer ordered, and **PO Date** is when they placed the order.
  - **Order Quantity** is what was actually manufactured, often about 2% more or less than the PO.
  - **TNS** is the manufacturer and **Trident** the exporter. Materials edits both remark columns from their dashboard.
- **Volumes (Q64):** not needed for the design. Free-tier storage is watched instead.
- **Phase 3 changed from the brief:**
  - **Order of steps:** after the payment check is approved, Logistics logs that the shipment sailed and posts updates (route, delays and so on) until delivery. When the buyer asks Logistics for the Bill of Lading, Logistics logs the request, creates and uploads the BoL, and it goes through approval (Accounts → Marketing → Approver → Head Approver(s), with its own people and ALL/ANY settings). Logistics then sends it to the buyer, and the order becomes **No Action Needed**. Logistics confirms delivery, and the order becomes **Done**, only after the BoL is sent.
  - **BoL rejection:** goes back to Logistics, to correct and re-upload the BoL.
  - **Superseded:** this replaces the brief's Phase 3 steps 5–9 and the answers to Q44–Q47.
- **Everything else:** the recommendations in `docs/v2-gap-analysis.md` apply, namely the rulings on C2–C8 and the answers to Q1–Q63 (except those replaced above). The ones that shape the build most:
  - **Creator** is a named person per order (Q1). **Marketing** creates orders (Q2). Buyers come from a **Buyer Master** (Q3). There is **no CFO** (Q4).
  - ~~One person can't fill two named slots in the same approval chain, and the Creator can't approve their own order (Q6).~~ Replaced by D26. Team pools have no exclusions at all (D23 is retired).
  - **Two PI versions** are two uploads (Q15). A PI rejection goes back to the Creator, and the chain restarts (Q16). A payment rejection goes back to Accounts (Q45).
  - **Per product:** raw-material ordering, the annexure, the artwork and packaging ordering (Q21, Q23, Q25). The "all delivered" gate is order-wide (Q28). Deliver Date filled means delivered (Q27).
  - **Tracker A** starts at Accounts' advance verification (C3). **Tracker C** is the time held, rounded up to whole days (Q50), in calendar days in India time (Q51).
  - **One dashboard per person,** with a tab per team or slot, oldest first (Q8, Q53, Q54).

### D25 — Choices made while building v2 (Claude Code, 20 Oct 2026; tell me if any are wrong)
**Status: PROPOSED, built and tested.** Small points the brief and D24 left open, decided so the build could go on:
- **Ordering tasks are done by a button.** "Order raw material" and "Order packaging and print" are completed by Materials pressing "Ordered" (with an optional comment). Delivery is tracked separately in the component tables, and the "all materials delivered" step waits for every row's Deliver Date. This refines Q21: if the ordering tasks completed by themselves on delivery, Tracker C would count waiting for suppliers as Materials' own working time.
- **The delivered gate doesn't reopen.** Once every component has a Deliver Date, Production QA opens. Clearing a date afterwards doesn't take QA away; Production can send work back to Materials instead.
- **Production QA's "Approve and hand over to Logistics" is the hand-over.** It isn't a separate step.
- **Teams and shipment statuses are fixed lists in the code for now:**
  - teams: Regulation, Materials, Design, Production, Accounts, Logistics;
  - shipment statuses: Sailed, In transit, Delayed, At port, Customs, Out for delivery, Other.

  Adding one is a small code change. Admin screens to edit them can come later if needed.
- **Products are fixed once production starts.** The Creator lists them with the PI and can change them while the PI is being reworked.
- **Marketing defaults to whoever creates the order** if the company names nobody. Gates always come from the company.
- **Tracker C on dashboards** is "with you in total": all the time the current holder has had that task, rounded up to whole days.
- **Demo data is spread over realistic days.** It is created through the real engine, then its timestamps are mapped onto a believable timeline. This is demo only; it briefly lifts the event log's append-only trigger inside its own transaction.

### D26 — One person can hold several roles on the same order (owner, 20 Oct 2026)
**Status: DECIDED.** Replaces Q6 and that point of D24.
- **Any combination:** a person can have any mix of teams and capabilities (Admin, Marketing, Creator, Approver, Head Approver), and their dashboard shows the work of all of them.
- **Several slots on one order:** the same person may fill several named slots of one order or company, including in the same approval chain, and the Creator may also be Marketing, Approver or Head Approver.
- **Only as different roles:** each slot is acted on separately. Someone who is both PI Approver and PI Head Approver approves once at the Approver stage and again at the Head stage, and the history shows which role each action was taken in. They still need the capability for each slot.
- **Still refused:** a slot left empty when an order starts, two people in a one-person slot (Marketing, Creator), and the same person listed twice in one slot.

### D27 — The owner's 11 changes after the v2 launch (owner, 20 Oct 2026)
**Status: DECIDED.** Built on top of D24–D26. New orders use workflow template **v2**; orders created before keep v1 (invariant 1).
- **Buyer = company.** The separate Company master is gone. Each buyer has its own **default chain** (named people and ALL/ANY per approval), and only Admin sets it. Marketing keeps the buyer's details (name, code, country, address, contact) up to date but can't change its chain. An order picks only a buyer.
- **Changing the chain for one order.** The order's Marketing person (and Admin) can change an approval stage's people and ALL/ANY for that order only, when creating it and later until that stage starts. Approvers choose nothing. The buyer's default stays as it is, and every change is in the order's history.
- **Order number.** New orders start as ORD-0001, ORD-0002… When submitting the PI, the Creator is prompted to change it to the PI number. The Creator, the order's Marketing person and Admin can change it later. Numbers are unique (case-insensitive), and every change is in the history.
- **Materials table:**
  - Materials can list every component of a product with just a name and type, before anything is ordered.
  - Each row shows a **Status** (Not ordered / Ordered / Dispatched / Delivered).
  - **Ordering delay:** days from production start to the PO Date, counting until ordered, then "took N days".
  - **Delivery time:** days from the PO Date to the Deliver Date, counting until delivered, then "took N days".
- **"Raw material ordered" / "Packaging ordered"** are refused until that product has at least one component of that type in the table.
- **Hand-over to Production** happens only when every component of every product has its PO Date, Dispatch Date, Deliver Date, Challan No. and LR Details. Quantities and remarks stay optional.
- **Documents on the step.** Whoever is reviewing or approving sees the latest version of the document the step is about (CBM, PI versions they may open, annexure, artwork, invoice, payment proof, BoL), with View and Download, on the step itself and on My Work.
- **Action buttons act directly.** One button per action: no separate selector, so there is no repeated "Confirm CBM" or "Approve". Sending back and rejecting ask for the reason in the comment box.
- **The page never scrolls sideways.** Wide tables scroll inside their own box.
- **Payments default to INR.**

### D28 — Materials notes in the table; Phase 1 comments private to some teams (owner, 22 Oct 2026)
**Status: DECIDED.**
- **Notes column.** The reason Materials gives when changing a component ("Why") was only in the row's history. The table now has an optional **Notes** column showing the latest reason, with who wrote it and when. Everyone who can see the Materials tab sees it.
- **Phase 1 comments are private.** People who see an order only through **Regulation, Design, Materials or Logistics** see the whole chain (steps, who acted, when) but not the comments on any Phase 1 step. That covers the CBM loop, the buyer confirmation, the PI, the PI approval (rejection reasons included), the advance request and the advance verification.
- **Who still sees them:** Admin; anyone named on the order; anyone in Accounts or Production; and anyone holding Marketing, Creator, Approver or Head Approver **anywhere**, even if not on this order.
- **Likely to change:** the owner may later switch that last rule to "only when named on this order". It is one setting in `apps/api/src/engine/access.ts` (`PRIVATE_COMMENT_ROLES`).
- **Enforced by the API, not just the screen** (like invariant 8). Hidden comments show as "Comment hidden". Order-level notes (the buyer's requirements, cancel reasons) are not affected.

### D29 — Private messages, Phase 2 privacy, payment proof and PO per component (owner, 31 Oct 2026)
**Status: DECIDED.** Replaces D28's Phase 1 comment rule. New orders use workflow template **v3**.

**Private messages**
- **The toggle:** every action (send, send back, confirm, approve, reject, complete, log, update) has a "Make this private" toggle. When it's on, the writer picks people and/or teams to share it with.
- **Who sees a private action:**
  - the writer;
  - the people and teams tagged;
  - everyone taking part in that step, so whoever gets the work back can read why;
  - **always** the order's approvers and Head Approvers (they can't be removed), and Admin.
- **Everyone else sees nothing at all,** not even that something happened. The step still shows who has it now.
- **Notices:** tagged people (members of tagged teams included) and the approvers get a notice on My Work ("Shared with you"), kept until marked read. No action is needed.
- **Reverts** are the same thing: a send-back or rejection with the toggle on.
- **Phase 1 comments are visible to everyone who sees the order,** unless made private. This replaces D28.

**Phase 2 privacy**
- **Hidden from Marketing alone:** Phase 2 is hidden from people whose only part in it is Marketing. They see it as one line, have no Materials tab, and their history shows only "materials complete" (the gate passing).
- **Still visible to:** anyone who is also in Materials, Design, Regulation or Production (e.g. Marketing + Design), approvers, Head Approvers and Admin.
- **Tagging overrides it:** a private message that tags someone shows to them even inside the phase hidden from them.

**Documents**
- **Approvers and Head Approvers** open every document of their orders.
- **Payment proof:** only Accounts, approvers, Head Approvers and Admin. Marketing and the Creator no longer can. When Accounts uploads one, the approvers get a notice.
- **PO per component:** on the "Order raw material" and "Order packaging" steps, Materials uploads a **purchase order (PO)** for each component of that type. Every one is **required** before marking it ordered. POs open only for Materials, approvers, Head Approvers and Admin; this may widen later via `docAccess.PO`. The Materials table has a PO column.
- **Enforced by the API everywhere:** order details, timeline, documents, file links and dashboards.

### D30 — Approvers see everything; PO area in the Chain tab; POs block progress (owner, 31 Oct 2026)
**Status: DECIDED.** Corrects D29.
- **Approvers and Head Approvers see everything, by role.** Anyone holding Approver or Head Approver sees every order, every phase (Phase 2 and the Materials tab included), every document (POs and payment proof included) and every private message, whether or not they are named on that order. D29 counted only the approvers named on the order, so an approver who was also that order's Marketing person, or not on it at all, lost Phase 2. Dashboard notices still go only to the approvers named on the order.
- **POs are for Materials and the approvers only:** not Admin, not Marketing, not the Creator, not other teams.
- **PO area in the Chain tab:** Phase 2 has a **Purchase orders** area listing every component of every product. Materials attaches each one's PO there (or on the ordering step); approvers view them.
- **POs gate progress:** "Raw material ordered" / "Packaging ordered" need every component of that type to have its PO, and **Materials complete** (the hand-over to Production) needs every component to have one, including components added later.
- **Running orders upgraded:** unfinished v2 orders move to workflow v3 (migration 0014), which differs from v2 only by the PO rule. This is a deliberate exception to invariant 1, asked for by the owner. Finished orders keep v2.

