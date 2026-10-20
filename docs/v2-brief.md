# DocFlow v2 — owner's brief (verbatim, received 20 Oct 2026)

This is the source requirement for v2, kept word for word as the owner sent it. Only the formatting was restored: step numbers, bullets and the component table. The brief itself refers to them ("step 7", "step 8"), and they were lost when it was pasted. Like `docs/URS.md` for v1, **never edit this file**. Answers and deviations go in `docs/decisions.md`. The analysis, open questions and build plan are in `docs/v2-gap-analysis.md`.

---

PART A — Instructions to Claude Code (read this part first, literally)

This is not a feature addition. It is a near-total redesign of the approval engine, the data model, and the dashboard logic. The workflow described in Part B does not fit the current workflow_steps / single-linear-or-parallel-chain model at all. Do not try to bolt it on. Treat this as DocFlow v2.

Rules for this session and every session after it, until told otherwise:

Do not write any product code in this session. Your only deliverable this session is a written document (save it as docs/v2-gap-analysis.md). It must contain:
A complete list of every open question and ambiguity you find in Part B below, including but not limited to the "Known Open Questions" list at the end of Part B. Do not guess at an answer and proceed — list it and move on. I will answer all of them in a follow-up, the same way decisions.md already works for v1.
A proposed new data model (tables/entities, at a conceptual level — not full DDL yet) capable of representing: role-pooled chain steps (a step belongs to a role, any member of that role can act on it), multiple independent backtrack/revision "channels" per order (not one generic comment thread), three distinct day-counters per relevant entity, an order → product → component hierarchy with the exact component table fields in Part B, OR-logic approval groups (any-one-of-N) alongside the existing all-must-approve groups, and two parallel versions of a document (with/without rates) gated to different role sets.
A gap analysis: what from the current schema/engine survives unchanged, what needs modification, what gets replaced outright, what becomes dead code to remove (call out workflow_steps, company_default_approvers, the position-based parallel-group logic, and decision D23's role-exclusivity rules by name, since Part B directly contradicts or obsoletes them).
A data-safety plan for the current live demo/production system. Do not assume I want a clean wipe or a parallel build — present the realistic options (e.g., archive v1 data and rebuild schema fresh; run v2 as new tables alongside v1 and migrate; version the engine behind a flag) with the tradeoffs of each, and ask me to pick. Nothing touching the live Render/Neon/Cloudflare/B2 resources happens until I've picked one.
A phased build plan, same style as plan.md's Phase 0–8 structure (small phases, a Gate for each, a Claude-Code prompt for each), covering the v2 engine, the Phase 1/2/3 workflow logic, the per-component tracking tables, the three day-counters, dashboard sorting, and the flowchart timeline view.
Stop after producing that document. Do not start Phase A of the new plan until I've answered the open questions and picked a data-safety approach.
Design for configurability, not hardcoding. I've told the owner I want to be able to change this workflow again later without a rebuild. Wherever Part B describes a chain (sequence of roles, ALL-required vs ANY-required/OR logic, which role sees which document version), propose representing it as data (a workflow/step definition) rather than code branching on "if phase2 and team==regulation". Flag anywhere you think a fully generic engine would be overkill and a semi-hardcoded approach is more honest about effort — I'd rather you say that than quietly build something rigid.
Everything in Part B that says "tracked" or "logged" means: actor, role, timestamp, and freeform comment, at minimum, queryable later per order. Treat this as a hard requirement everywhere it's mentioned, not just where it's repeated.
If something in Part B seems to conflict with something else in Part B, say so explicitly rather than picking one interpretation silently.

Decisions the owner has since confirmed — build to these, do not re-ask:

Notifications fire only when a chain advances to its next step, i.e. a role (or the next named individual) newly becomes the current actor on a step they weren't already the actor on. Back-and-forth/revision cycles within a channel (Section "Cross-cutting requirement 2" in Part B) do not trigger an email on every round. This includes a backward move (a revert) — a revert does not email the team it lands back on either; they find out via their dashboard (Cross-cutting requirement 4), which already surfaces pending/returned work sorted by urgency. Flag this explicit choice in your gap-analysis doc so the owner can veto it if "silent reverts" turns out to feel wrong once dashboards are in use — but build it as described unless told otherwise.
Company Master is retained, not removed. Chains are mostly uniform across companies, but the owner wants the ability to vary a chain per company (exact scope of what varies is still open — see open questions). Keep Company Master as a real configuration entity; don't assume it becomes a pure label.
Role-pool ("anyone holding this role can act") logic applies only to: Regulation, Production, Materials, Design, Accounts, and Logistics. Marketing, Approver(s), and Head Approver(s) are individual, named actors — a specific person, not "anyone in a role" — and should be modeled accordingly (e.g. assigned by name at chain-configuration time, not resolved from a role at runtime).
Head Approver steps need a configurable gate type, chosen per step/chain: ALL (every named Head Approver on that step must approve) or ANY (a single approval from any one of them is enough). This is not fixed per step — it must be settable, since some approvals will need ALL and others ANY (the owner gave Phase 1's single-Head-Approver step and Phase 3's OR-gated steps only as examples, not as the full set of combinations that will exist).
Every payment event is verified and advanced by the Accounts team, specifically: the advance payment (Phase 1 → Phase 2 transition) and the remaining/balance payment after invoice packaging (Phase 3). "Verifies and updates the chain" means Accounts is the actor who confirms a payment happened and moves the relevant step forward — it's not a passive status flag anyone can set.
Materials team tasks are tagged by type — "raw material" or "packaging" — and the Materials dashboard must support filtering by that tag, in addition to showing both together by default. This tagging is structural, not cosmetic: Phase 2 now branches into separate raw-material-ordering and packaging/annexure tracks at Materials team level (see the rewritten Phase 2 flow in Part B) and the tag on each task should reflect which track it belongs to.
The per-component tracking table's field list has been revised — use the version in Part B's Phase 2 section, not an earlier draft. Materials team can edit any field on any row at any time while the order is in the production phase and the chain hasn't advanced past material receipt; this is live, continuously-editable data, not a gated step-by-step action.

PART B — The new workflow (owner's description, organized)

Overview: three phases

Phase 1 — Sales & PI approval. Ends when advance payment is received. This is also when production work begins (Phase 2 start).
Phase 2 — Production. Multiple teams working off two different versions of the PI (with/without rates), converging at Production QA, ending when Production hands off to Logistics.
Phase 3 — Logistics & shipment. Ends when the buyer confirms receipt of the Bill of Lading.

Two tracked counters run for the whole lifecycle; a third runs per-team inside Phase 2 (and possibly Phase 3 — see open question). All three detailed in their own section below.

Phase 1 — Sales & PI approval

1. Off-system. Marketing talks to the buyer about requirements. Not recorded in the app.
2. Chain begins here. Marketing relays the buyer's requirements to the Creator.
3. Creator drafts a CBM (container calculation based on quantity — exact meaning of the acronym to be confirmed, not critical to the build) and sends it to Marketing.
4. Marketing reviews the CBM. Can send it back to the Creator with comments; this can go back and forth an arbitrary number of times. Every round must be tracked. Only proceeds once Marketing confirms it's correct.
5. Marketing sends the confirmed CBM to the buyer (off-system or logged — see open question) and confirms it. This confirmation is the anchor for Tracker B ("days since chain began").
6. Marketing tells the Creator to draft a Performa Invoice (PI).
7. Creator drafts the PI. At this point the Creator also produces a second version of the same document with no rates, and no buyer name/address — only quantities. (Open question: auto-generated by the system from one source document, or two separate uploads? See below.)
8. Creator submits the PI for approval. Approval chain: Marketing → Approver 1 → Head Approver, in that order. Marketing, Approver 1, and Head Approver are each a named individual (not a role-pool — see Part A). This particular Head Approver step is a single required approver, i.e. its gate type happens to be ALL with a group size of one — but still build it using the same configurable ALL/ANY gate as the Phase 3 steps below, not a special case.
9. Once approved, Marketing sends the PI to the buyer and requests an advance payment.
10. Accounts team verifies the advance payment has been received and marks it — this is the confirming action, not a self-reported status from Marketing. Once Accounts verifies it, Phase 2 begins. This moment is the anchor for Tracker A ("days since PI approved" / production start). (Open question: does advance payment verification need any further sign-off beyond Accounts — e.g. Marketing/Approver/Head Approver, the way the Phase 3 payment does — or is Accounts' verification alone sufficient to start Phase 2? See open questions.)

Phase 2 — Production

Teams: Regulation, Materials (raw material/API + packaging material — one combined team), Design, Logistics, Accounts, Production.

Document access split, based on the two PI versions from step 7 above:

- No-rates version (quantities only): Regulation, Materials, Design teams.
- With-rates version (full PI): Logistics, Accounts, Production teams.

Flow — three tagged tasks branch off the moment Phase 2 starts:

1. Materials team, tagged "raw material": begins ordering raw material (API) per product. Runs independently/in parallel with the other two branches below — not gated on anything.
   Materials team, tagged "packaging": drafts the packaging annexure, sends it to Regulation team.
   Design team: sends updated artwork to Regulation team. (Design is its own team, not tagged under Materials — only the annexure is a Materials-tagged packaging task.)
2. Regulation team reviews both the annexure and the artwork. Can reject either one back to its origin team (Materials for the annexure, Design for the artwork) with comments — tracked, timestamped, unlimited back-and-forth. Neither the raw-material branch nor the chain overall advances past this point until BOTH the annexure and the artwork are confirmed by Regulation, independently of each other (one can be confirmed while the other is still bouncing back and forth).
3. Once both are confirmed: a new task opens — Materials team, tagged "packaging": order packaging materials and begin printing. This task did not exist before Regulation's confirmation; it's created at this point, not merely unblocked.
4. Materials team dashboard requirement: at any point from step 1 onward, a Materials team member's pending-task list contains a mix of "raw material"-tagged and "packaging"-tagged tasks (raw material ordering; later, once unlocked, packaging ordering/printing — the annexure task itself is also "packaging"-tagged while it's active). The dashboard must let them filter the list down to just one tag, or clear the filter to see both together.
5. Once every component across every product on the order shows as delivered in the per-component tracking table below (not just "raw and packaging materials have arrived" as a vague milestone — the table's delivery status is the actual gate), the chain moves to Production team.
6. Production team inspects quality/condition of received materials. Can find "any issue" with packaging or raw materials and reverts back to the relevant team (Materials, or Design if it's an artwork/print issue) with notes. Unlimited back-and-forth, tracked.
7. Once satisfied, Production team hands off to Logistics team — this marks the end of Phase 2.

Order → Product → Component hierarchy: one order can contain multiple products (e.g. Prod A, Prod B…). Each product has its own set of components — a mix of packaging materials and raw materials (e.g. Prod A → pack mat 1, pack mat 2, raw mat 1, raw mat 2, raw mat 3). Each product gets its own tracking table, with one row per component. Revised field list (replaces any earlier draft):

| Column | Notes |
|---|---|
| Sr. No. | |
| Prod Name | the component's own name (despite the field name, this is the component, not the parent product — the parent product is what groups these tables) |
| PO Quantity | quantity on the purchase order — note this replaced "PI Quantity" from an earlier draft; confirm in open questions whether this is really PO-sourced or still PI-sourced |
| Order Quantity | |
| PO Date | order placement date — replaces "PI Date" from an earlier draft |
| Dispatch Date | |
| Deliver Date | |
| LR Details | lorry receipt — specifically, the point at which the item is released from the dispatcher |
| Challan No. | the delivery challan number, one per item/component within a product |
| Trident Remark | |
| TNS Remark | the manufacturer's remark |

Note what's not in this revised list that was in an earlier draft: a standalone "Received Quantity" column. See open questions — confirm whether partial/received quantity still needs its own field or whether Deliver Date alone is meant to indicate full receipt. The three day-counters (Tracker A, Tracker C, and a PI/PO-anchored day count) still apply to this table as before — they're cross-cutting and aren't re-listed as columns here, but build them in alongside the fields above.

Editability and the Phase 2 gate, precisely: Materials team can edit any field on any row, at any time, for as long as the order sits in Phase 2 and the chain hasn't yet advanced past Production hand-off. This is not a formal submit/approve action — it's live, continuously-editable data. The chain only advances (per Phase 2 flow step 7 above) once every row across every product's table shows as delivered. Confirm in open questions whether that gate is truly order-wide (every product must finish before any of them proceeds) or can be evaluated per-product.

If an order has 5 products, there are 5 of these tables.

Phase 3 — Logistics & shipment

1. Logistics team relays container/sizing information to Marketing, based on what came out of production. This is Back-and-forth Channel 1 — tracked, timestamped, distinct from other channels.
2. Once finalized, Marketing tells Logistics to prepare the actual invoice (true invoice, based on real goods size/quantity — distinct from the PI), i.e. invoice packaging. Logistics does the invoice packaging and shares it back to Marketing. This is Back-and-forth Channel 2 — tracked separately from Channel 1, even though it's also between Marketing and Logistics.
3. Marketing asks the buyer for the remaining payment. Marketing logs in the app that they've asked — this is a status update only; Marketing cannot verify whether the buyer has actually paid.
4. Payment verification chain (4 stages): Accounts → Marketing → Approver → Head Approver. Accounts verifies the payment has actually arrived; Marketing then signs off; then a named Approver; then the named Head Approver(s), gated ALL or ANY per the configurable setting in Part A (the owner's example uses ANY here). This is a 4-stage chain, not 3 — it includes an Approver stage distinct from Marketing and distinct from Head Approver, the same way Phase 1's PI approval chain does.
5. Bill of Lading (BoL) is generated, once the payment verification chain above completes.
6. The same 4-stage chain runs again as a release decision: Accounts → Marketing → Approver → Head Approver, this time deciding whether to actually share the BoL with the buyer at all — not purely re-verifying payment (see open questions on what else this stage might be judging).
7. Once that second chain completes, the BoL is released to the buyer. At this point the order is marked "No Action Needed" — explicitly not "Done".
8. Logistics team tracks the shipment from this point until the buyer actually receives it, by posting an arbitrary number of status checkpoints/updates (e.g. "set sail", "at port", etc.), each with its own reason and timestamp — they can add as many of these as needed, there's no fixed count.
9. Logistics closes the chain once the buyer has received the shipment — this is the final event in the entire chain, and only Logistics can do it, since they're the ones in contact with the buyer at this stage. The order is marked "Done" at this point, not before.

Note what changed from an earlier draft: shipment-status checkpointing used to be modeled as happening before the final payment ask and BoL generation. It's now understood to run after BoL release, continuing until delivery — it's the actual closing mechanism for the whole chain, not an intermediate step.

Cross-cutting requirements (apply across all phases, unless noted)

1. Two different actor models, used for different steps — do not unify them into one mechanism.

Role-pool teams (team-wide logic, "anyone holding this role can act"): Regulation, Production, Materials, Design, Accounts, Logistics. A step assigned to one of these is pending for every employee holding that role; any one of them can act on it. One employee can hold any number of these roles simultaneously, with no mutual exclusion between them (e.g. someone can be in both Regulation and Production). A person with multiple role-pool roles has a dashboard per role (or one dashboard with a tab per role — Claude Code's call, flag the tradeoff).
Named-individual actors: Marketing, Approver(s), Head Approver(s). These steps are assigned to specific people by name at chain-configuration time (per Company Master, or per-order if customised — see open questions), not resolved from a role pool at runtime. A Head Approver step additionally carries a configurable gate: ALL (every named person on it must approve) or ANY (one approval from the group is enough) — see Part A.

These are structurally different mechanisms (resolve-by-role vs. assign-by-name), not the same thing with different settings — build them as two deliberately distinct concepts, even if they end up sharing some underlying "who can act on this step" plumbing.

2. Backtracking is tracked as distinct channels. The document calls out several separate kinds of back-and-forth that must not be merged into one generic thread:

- CBM revisions (Creator ↔ Marketing)
- Annexure revisions (Materials ↔ Regulation)
- Artwork revisions (Design ↔ Regulation)
- Production QA reverts (Production ↔ Materials/Design)
- Container/sizing back-and-forth (Logistics ↔ Marketing)
- Invoice-packaging back-and-forth (Logistics ↔ Marketing — distinct from the above even though same two teams)

Each must be independently identifiable (so you can query "show me all annexure revision cycles for this order", not just "show me all comments").

3. Three day-counters, tracked and visible everywhere relevant, always paired with the actual date/timestamp they're computed from:

- Tracker A — Days since PI approved (= Phase 2/production start). Shown throughout Phase 2 and Phase 3.
- Tracker B — Days since CBM confirmed (= chain start). Shown everywhere.
- Tracker C — Days actively being worked on, per team, per task. This is the nuanced one. Worked example from the owner: Materials gives their first annexure draft on day 1. It takes Regulation 3 days to review, and they reject it with changes needed. Materials makes changes the next day. Even though 5 calendar days have passed (1 + 3 + 1), Materials' dashboard should show 2 days — because the task was only actually sitting on Materials' plate for 2 of those 5 days (day 1, and the day they reworked it); the 3 days it was with Regulation don't count against Materials. The owner confirmed this applies to Regulation, Materials, Design, and Production in Phase 2. Open question below on whether it also applies anywhere in Phase 3.

4. Dashboard sorting and filtering (Phase 2 team dashboards, at minimum — confirm if Phase 3 dashboards need the same): pending tasks are sorted by default with the longest-pending task first (most urgent at top) — e.g. a 25-day-old task above a 7-day one above a 2-day one. Filters still available for buyer name, dates, and current chain stage. Materials team's dashboard additionally needs a task-type filter — "raw material" vs "packaging" (see the confirmed decision in Part A and the rewritten Phase 2 flow) — showing both by default, filterable down to one tag, and clearable back to both.

6. Notifications only on forward step-advancement (confirmed in Part A): a step's new current actor(s) — the role-pool team or the named individual(s) — get an email the moment a step becomes newly pending for them, whether that's the chain moving forward for the first time or a revert landing back on a team that already acted before. What does not email: every intermediate round of a back-and-forth within a channel while it stays with the same current actor (e.g. Regulation rejecting the annexure back to Materials does email Materials once, since Materials is now the current actor again — but Materials re-submitting and Regulation looking at it again does not re-email Regulation beyond the one email they already got when it first became their turn, unless it had moved away from them and come back). State this precisely in the gap-analysis doc as a proposed rule and flag it for confirmation, since the exact boundary of "newly pending" vs. "still pending, just updated" matters here.

5. Visual timeline. From any dashboard, it must be possible to pull up a given order/chain's complete timeline — including all backtracks/comments across all channels — rendered as a readable flowchart. The per-product/component tables (Phase 2 section above) must also be viewable scoped to a specific order, so any component's exact status and timestamps can be traced.

Known open questions (owner has not yet answered these — Claude Code must list these back, plus any more it finds, rather than guessing)

Data safety / migration

- Should the live v1 demo data be archived and the schema rebuilt clean, or should v2 be built alongside v1 with a migration path? (See Part A, rule 1.)

Phase 1

- Is the CBM back-and-forth a formal reject-with-reason action (like v1's reject), or freeform commenting with no formal state gate?
- Is "Marketing sends CBM to buyer and confirms" a logged milestone with its own timestamp (needed as Tracker B's anchor), or inferred from some other event?
- Are the two PI versions (with/without rates, without name/address) auto-derived by the system from one source document, or two separate manual uploads by the Creator? This materially changes the build.
- In the PI approval chain (Marketing → Approver 1 → Head Approver), can each stage reject, and if so does a rejection go back to the Creator, or to the immediately previous stage?
- Who marks "advance payment received" in the app — Marketing, Accounts, or either? Is there a verification/approval step on it, or just a status + date entry?

Phase 2

- Is Materials (raw + packaging) genuinely one role/team/dashboard with tagged tasks (as now specified), or should raw material and packaging actually be two separate roles that happen to be held by the same people? The owner's wording says one team with tagged tasks — confirm this reading is right before building the tag as metadata rather than a role split.
- Does raw material ordering have any approval/confirmation step, or is it just "ordered" → later "received" (i.e. the component table rows get filled in) with no gate?
- If Regulation rejects the annexure, does Design's artwork review pause too, or do they continue independently? (Spec implies independent, confirm.)
- Does the Production QA revert ever target something other than Materials or Design (e.g., can it also go back to Regulation)?
- Who marks a component's row as delivered in the tracking table — Materials/Packaging team only, or does Logistics have any role here before Phase 3 starts?
- Exact Tracker C rule: does a team's clock run only while the task's current responsible role equals that team, full stop (i.e., a fully generic "time spent as current assignee" rule), or is there a different definition? Confirming this as the generic rule before it's built everywhere.
- Are products and components drawn from a master catalog (so "pack mat 1" is a consistent, reusable entity across orders) or freeform text per order?
- Component table — is "PO Quantity" genuinely sourced from a Purchase Order document (a new concept not previously described), or is this the same figure that used to be called "PI Quantity," just renamed? If it's genuinely PO-sourced, where does the PO itself come from — is Materials team expected to raise/attach one, or is this just a quantity figure with no accompanying document?
- Is there still any need to track partial/received quantity per component (e.g. 80 of 100 units arrived so far), given "Received Quantity" was dropped from the revised field list — or does Deliver Date alone mark a row fully received?
- Is the "all components delivered" gate for advancing past Phase 2 evaluated order-wide (every product's every component) or per-product (so one product's chain could reach Production while another product on the same order is still waiting on materials)?

Phase 3

- Is the container/sizing back-and-forth (Channel 1) gated the same way as a formal reject (blocks chain advance), or more like a logged discussion with no gate?
- Same question for the invoice-packaging back-and-forth (Channel 2).
- Does Tracker C's "pause while elsewhere" logic apply to anything in Phase 3, or only Phase 2 as stated?
- Is the "Approver" in Phase 3's two 4-stage chains the same named individual as Phase 1's "Approver 1," or a different person entirely?
- Are the payment-verification chain (step 4) and the BoL-release chain (step 6) necessarily configured with the same ALL/ANY gate setting and the same named Head Approver(s), or independently configurable?
- What exactly is the BoL-release chain (step 6) judging, if not purely payment? The owner described it as "do we actually want to share the BoL to the buyer or not" — is there a defined set of reasons this could be declined (e.g. a documentation issue, a compliance hold), or is it a general-purpose final sign-off with no fixed criteria? This affects whether the UI needs structured reason categories or just free text.
- If either 4-stage chain (payment verification or BoL release) is rejected at any stage, what happens? Does it go back to Marketing to re-request payment, back to the previous stage only, or something else? (Same category of question as Phase 1's PI approval chain, not yet answered there either.)
- When a step is assigned to a role with multiple members (e.g., ANY-gated Head Approvers, or any role-pool in general), does every member see it as pending simultaneously, with first-to-act resolving it? Is there a risk of two people acting at once that needs the same transactional locking pattern v1 already uses?
- Shipment checkpoints (step 8) — are these purely a free-form log, or does each checkpoint need a structured status field (e.g. a fixed set of stages like "sailed," "at port," "customs," "out for delivery") in addition to free text, since the dashboard/timeline view presumably wants to show current shipment status at a glance?

Cross-cutting

- v1's decisions.md D23 restricts role combinations and prevents self-approval structurally. The new spec wants no exclusivity across the role-pool teams (Regulation, Production, Materials, Design, Accounts, Logistics) — but does self-approval prevention still apply to the named-individual actors (Marketing, Approver, Head Approver), e.g. can the same named person sit as both Marketing and a Head Approver on the same order, and if so can they action both steps themselves?
- Company Master is retained — but what exactly does it vary per company? The owner confirmed chains can differ by company but didn't specify the scope. Candidates to confirm: which named individuals fill Marketing/Approver/Head Approver slots per company; which role-pool teams are even involved for that company (e.g. does every company go through all of Regulation/Materials/Design, or could some skip steps); the ALL/ANY gate setting on Head Approver steps; something else entirely. Needs a concrete answer before the Company Master data model can be redesigned.
- Does a Creator (or anyone) get to customize the named-individual assignments or gate settings per-order, the way v1 let a Creator customize a company's default approver chain per document, or is the Company Master config always used as-is for v2?
- With emails now limited to forward step-advancement only, is a role-pool team ever expected to notice a revert before it next checks its dashboard (e.g. does "dashboard-only" visibility risk a stuck revert sitting unnoticed for days, undermining the whole "days pending" urgency-sorting feature)? Confirm this tradeoff is acceptable as designed, given it was an explicit choice to cut email volume.
- Is the "newly pending" notification boundary (Cross-cutting requirement 6) correct as drafted, or did the owner mean something narrower/broader?
- Payment verification depth is inconsistent between phases as currently described — Phase 1's advance payment is verified by Accounts alone, while Phase 3's remaining payment goes through a full 4-stage Accounts→Marketing→Approver→Head Approver chain. Is that difference intentional (advance payment is lower-stakes / smaller amount, so a lighter check is fine), or should advance payment get the same multi-stage treatment for consistency? Don't assume either way — ask.
