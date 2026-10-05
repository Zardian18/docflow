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
**Status: recommendation only, not yet confirmed.** URS §5.8/§9 puts exports and summary statistics out of scope for v1; Figma's Admin Dashboard shows both. I still recommend **dropping Export** and keeping the four simple count cards (they're cheap and non-analytical). Confirm before Phase 6.

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
- **Cron worker:** a second Workers Builds project, `docflow-cron`, with root directory `infra/cron-worker`. It runs every 20 minutes, and `workers_dev` is off (cron only, no public URL). Its secret `TICK_SECRET` has the same value as the API's `TICK_SHARED_SECRET`.
- **API: Render free web service `docflow`.** Render can't see files outside a service's Root Directory, so the service builds from the **repo root**:
  - Root Directory: empty
  - Dockerfile Path: `./apps/api/Dockerfile`
  - Docker Build Context: `.`
  - Build Filters: `apps/api/**`, `packages/shared/**`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
  - Health check: `/healthz`
- **Migrations run on container start** (`node dist/migrate.js && node dist/server.js`) over `DATABASE_URL_DIRECT`, guarded by a Postgres advisory lock. The free tier has no Pre-Deploy Command.
- **No GitHub deploy workflows.** Both hosts deploy from their own git integrations on push to `main`, and GitHub Actions runs CI only (`.github/workflows/ci.yml`). Nightly backup (`backup.yml`) is still planned for Phase 7.
- **One environment, no staging yet.** plan.md §6 assumed staging plus a production approval gate. Add a separate Neon branch and Render service for staging before real data goes in (Phase 7/8).
- **Neon:** Singapore region (Render and Cloudflare regions are the owner's choice). The pooled string serves runtime queries and the direct string serves migrations.
- **Backblaze B2** endpoint `s3.eu-central-003.backblazeb2.com` (region `eu-central-003`), private bucket with a scoped key. Not used by code until Phase 3.
