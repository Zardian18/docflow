**USER REQUIREMENT SPECIFICATION**

Document Approval Workflow Management System

Prepared for: [Client Name]

Version: 1.0 (Draft for Review)

Date: 25 August 2026

# **Table of Contents**

	**Table of Contents**	1

	**1. Introduction**	1

	**1.1 Purpose**	1

	**1.2 Scope**	1

	**2. Definitions ****&**** Abbreviations**	1

	**3. User Roles ****&**** Permissions**	1

	**4. Master Data Requirements**	2

	**4.1 Role Master (Simplified)**	2

	**4.2 Employee Master**	2

	**4.3 Company Master**	3

	**5. Functional Requirements**	3

	**5.1 Document Upload ****&**** Company Selection**	3

	**5.2 Search ****&**** Autocomplete Behavior**	4

	**5.3 Ordered Approval Chain**	4

	**5.4 Approve / Reject Behavior**	4

	**5.5 Approval Log / Audit Trail Visibility**	4

	**5.6 Notifications**	5

	**5.7 Workflow Status Values**	5

	**5.8 Admin Dashboard (New)**	5

	**6. Business Rules Summary**	5

	**7. Suggested Optimizations (Remaining)**	6

	**8. Confirmed Decisions ****&**** Remaining Open Questions**	6

	**8.****1**** Still open — please confirm with client**	6

	**9. Out of Scope (v1)**	6

	**10. Appendix: Workflow Summary (Text Form)**	7

# **1. Introduction**

## **1.1 Purpose**

This document defines the functional requirements for a Document Approval Workflow Management System. The system automates the routing of uploaded documents through a company-specific, ordered approval chain, ending with a mandatory Chief Financial Officer (CFO) approval, and notifies stakeholders by email at each stage.

## **1.2 Scope**

The scope covers three configuration masters (Role Master, Employee Master, Company Master), a document upload and workflow-initiation screen for the Creator role — including type-ahead search, the ability to add or reorder approvers for that single document, and a reset to defaults — approve/reject actions with mandatory rejection reasoning and optional approval remarks, a visible approval audit trail, a filterable Admin dashboard across all workflows, and email notifications at every transition. Advanced analytics/exports, document versioning, and mobile applications are not covered unless explicitly added to a future phase (Section 9).

# **2. Definitions ****&**** Abbreviations**

| **Term** | **Definition** |
| --- | --- |
| Creator | The user who uploads a document and initiates the workflow. Does not approve. |
| Approver | Any employee placed into a chain to review and approve/reject a document. |
| CFO | Final, mandatory approver for every workflow. A single, fixed employee, constant across all companies and always last. |
| Role Master | A simple, admin-maintained list of role names (e.g. Creator, Approver, CFO, Admin) used purely as a label on Employee Master records. Carries no ordering information. |
| Order / Position | The sequence number assigned to an approver within a company's default chain (set in Company Master), or within a specific document's chain if the Creator has customised it. Lower number = earlier in the chain. |
| Type-ahead search | A search box that filters results live as the user types, rather than requiring the user to scroll a long list. |
| Company Master | Configuration list of companies, each with its own default, ordered list of approvers (minimum two). |
| Employee Master | Configuration list of employees, each linked to one role name from the Role Master. |
| Workflow Instance | One document's specific approval journey, created at upload time. Stores the actual approver order used — which may be the company default or a Creator-customised order — as a permanent snapshot. |

# **3. User Roles ****&**** Permissions**

Role names themselves are configurable via the Role Master (Section 4.1), but the four below cover the core permission behaviours the system needs.

| **Role** | **Description** | **Key Permissions** |
| --- | --- | --- |
| Admin | Maintains configuration data. | Create/edit Role Master and Employee Master; create/edit Company Master including each company's default approver list (minimum two) and their order. View the Admin Dashboard across all workflows. Only Admin can permanently change a company's default chain. |
| Creator | Uploads documents. | Search and select a company, view auto-populated approvers in default order, optionally add extra approver(s) via employee search and reorder the chain — for that document only, with the option to reset to the company default. Submit document. |
| Approver | Reviewer(s) placed in a document's chain, notified in order. | View pending document with full history so far; Approve (remarks optional) or Reject (reason mandatory). |
| CFO | Final approver on every workflow, fixed globally. | View pending document with complete chain history; Approve (remarks optional) or Reject (reason mandatory). Position is always last and can never be moved. |

# **4. Master Data Requirements**

## **4.1 Role Master (Simplified)**

Purpose: a simple, flat list of role names that Admin maintains. It exists only so the Employee Master has a consistent dropdown to pick from — it does not carry any priority, category, or ordering information.

| **Field** | **Type** | **Notes** |
| --- | --- | --- |
| Role Name | Text | Mandatory, unique. E.g. Creator, Approver, CFO, Admin, or any future custom name. |

| **Note** All chain ordering has moved to the Company Master (Section 4.3) and, temporarily, to the document itself (Section 5.1). Role Master is now purely a naming/labelling list — nothing here restricts or sequences the approval chain. |
| --- |

## **4.2 Employee Master**

Purpose: maintains the pool of people who can be placed into an approval chain, each linked to one role name for labelling purposes.

| **Field** | **Type** | **Notes** |
| --- | --- | --- |
| Employee Name | Text | Mandatory. |
| Id | Text | Mandatory, unique; used for login/identification. |
| Email | Text | Mandatory, unique; used for notifications. |
| Role | Dropdown, sourced from Role Master | Mandatory, descriptive label only — does not restrict who can be selected as an approver (see open question 8.2). |

*Business rule: only one active Employee record may hold the CFO role at any given time, since the CFO is confirmed as a single, fixed person across every company.*

## **4.3 Company Master**

Purpose: lets Admin create a company and define its default approval chain, including the order approvers act in. This default is what auto-populates whenever a Creator selects that company — the Creator can view and temporarily adjust it per document, but only Admin can permanently change it here.

| **Field** | **Type** | **Notes** |
| --- | --- | --- |
| Company Name | Text | Unique, mandatory. |
| Company Code | Text | Optional short code; also searchable when a Creator looks up the company (Section 5.2). |
| Default Approvers | Ordered list: Employee + Position | Mandatory, minimum 2 entries — the system must block saving a company with fewer than 2 approvers. Additional approvers beyond the minimum are optional. Admin assigns/reorders each entry's Position (1, 2, 3…). |
| CFO | Auto-filled, read-only | Always the single active CFO from Employee Master. Always last; not part of the Position list and not editable at company level. |
| Status | Active / Inactive | Inactive companies are hidden from the Creator's search/dropdown. |

*Business rule: Position values within a company's Default Approvers list must be unique — no two approvers can share the same position. A company cannot be saved with fewer than 2 Default Approvers. Only Admin can create, edit, or reorder a company's Default Approvers.*

# **5. Functional Requirements**

## **5.1 Document Upload ****&**** Company Selection**

- On login, the Creator sees a limited, purpose-built screen ("New Submission") — no access to masters or other users' workflows.

- The Creator uploads the document file.

- The Creator finds the Company using a type-ahead search box (see Section 5.2) rather than scrolling a long dropdown, and selects it.

- On selection, the company's Default Approvers auto-populate in the order defined in Company Master (minimum 2 shown).

- The CFO field is always shown, pre-filled, and locked (read-only / greyed out), fixed as the final step — visible for transparency but never editable or reorderable by the Creator.

- The Creator may, for this document only: (a) add further approver(s) found via employee type-ahead search, and/or (b) reorder the approver sequence (e.g. drag-and-drop or up/down controls) — the CFO position can never be moved.

- A “Reset to Company Default” control is available whenever the Creator has added or reordered approvers, letting them revert this document's chain back to the company's standard order in one action.

- Any additions, reordering, or reset apply only to this specific Workflow Instance. The Company Master's default chain is never modified by a Creator; only Admin can permanently change it (Section 4.3).

- The Creator submits the document, which creates a Workflow Instance and permanently snapshots the exact approver order used (default or customised).

## **5.2 Search ****&**** Autocomplete ****Behavior**

Two distinct search contexts, each scoped to different fields:

| **Search Context** | **Fields Searched** | **Match ****Behavior** |
| --- | --- | --- |
| Selecting a Company (document upload) | Company Name AND Company Code | Type-ahead, matches from the start of either field, case-insensitive. E.g. typing “MIC” surfaces every company whose name or code starts with MIC. Only Active companies are searchable. |
| Adding an Extra Approver (document upload) | Employee Name only | Type-ahead, matches from the start of the name, case-insensitive. Selection is temporary to this document only — never saved to Employee Master or Company Master. |

## **5.3 Ordered Approval Chain**

The workflow moves through approvers strictly one at a time, in ascending position order:

- Approver(s) in the order set on the Workflow Instance — the company's default order, or the Creator's customised order for that document

- CFO — always the final step, fixed and unmovable for every company and every document

Each approver only sees the document once every prior approver in the chain has approved it. A pending document is never visible to an approver whose turn has not yet come.

## **5.4 Approve / Reject ****Behavior**

| **Action** | **Remarks/Reason Field** | **System ****Behavior** |
| --- | --- | --- |
| Approve | Optional free-text remarks | Workflow moves to the next approver in order. If approved by the CFO, the workflow is marked Completed and the Creator is notified. |
| Reject | Mandatory free-text reason (cannot submit without it) | Workflow immediately ends (status: Rejected). All remaining approvers are skipped. The Creator is notified by email with the rejecting approver's name and reason. |

## **5.5 Approval Log / Audit Trail Visibility**

Every approver must see who and what came before them, so the chain is fully transparent by the time it reaches the CFO. The log always reflects the actual order used for that document (default or Creator-customised), not the company's generic default.

- When the first approver opens the document, they see who created it (Creator name, submission date/time).

- When the second approver opens the document, they additionally see the first approver's decision (name, timestamp, and remarks if any).

- This accumulates at every subsequent step — each approver sees the full history of everyone before them, not just the immediately preceding step.

- By the time the CFO opens the document, they see the complete chain: Created by → Approved by each step in order (with remarks) → pending CFO sign-off.

- This same history, including whether the chain was customised for this document, is available on the dashboard/logs view at any time, including after completion or rejection, for audit purposes.

## **5.6 Notifications**

All notifications are sent by email. Required triggers:

- The first approver in the chain's order is notified when a new document is submitted.

- Each subsequent approver is notified as soon as the one before them (in order) approves.

- The CFO is notified once the last approver in the chain approves.

- The Creator is notified when the CFO gives final approval (workflow Completed).

- The Creator is notified immediately if any approver in the chain rejects, including the rejection reason.

## **5.7 Workflow Status Values**

| **Status** | **Meaning** |
| --- | --- |
| Pending Approver (Position N) | Submitted; waiting on the approver at position N of this document's chain. |
| Pending CFO | All approver positions have approved; waiting on CFO. |
| Completed | CFO approved; workflow closed successfully. |
| Rejected | Any approver rejected; workflow closed. |

## **5.8 Admin Dashboard (New)**

A structured, filterable view for Admin covering every document in the system, regardless of status:

- List/table view with one row per Workflow Instance, showing: Document name, Company, Created By, Current Status, Submitted Date, Last Updated.

- Filters: Status (Pending at a given position / Pending CFO / Completed / Rejected), Company, Created By, and a Date Range (submitted date).

- Clicking into any row opens that document's full audit trail (Section 5.5) — created by, every approval/rejection with remarks, in order.

- This is a structured list view, not an analytics/charting dashboard — graphs, exports, and summary statistics remain out of scope for v1 (Section 9).

# **6. Business Rules Summary**

- An employee must exist in the Employee Master, with a role label, before they can be placed into any approval chain.

- Role Master carries no ordering — chain order is defined entirely at the Company Master (default) and, optionally, per document by the Creator (temporary override).

- A company must have at least 2 Default Approvers to be saved; additional approvers beyond that are optional.

- Position values must be unique within a company's Default Approvers list, and within any Creator-customised chain for a document — the system should block a duplicate position.

- CFO is a single, fixed, global employee across every company — not company-specific — always the final step, and can never be reordered, removed, or replaced by a Creator.

- Only Admin can create or permanently edit a Company Master record, including its default approver order. A Creator's per-document additions/reordering never write back to Company Master, and can be undone via “Reset to Company Default.”

- Company search matches Company Name or Company Code; employee search (for adding an extra approver) matches Employee Name only. Both are live, case-insensitive, start-of-field matches.

- Approval is strictly sequential by position; no two approvers act in parallel.

- A rejection at any stage is final — there is no revision/resubmission loop unless explicitly requested as a future enhancement (see Section 8).

- Rejection reason is mandatory; approval remarks are always optional.

- Only Active companies appear in the Creator's company search.

- The exact approver order used for a document — whether the company default or a Creator's customised order — is snapshotted onto the Workflow Instance at submission time, so later changes to Company Master, or to another document's customisation, never retroactively alter an in-flight or completed workflow.

- Employees or role names with existing approval history should be deactivated rather than deleted, so past audit trails (Section 5.5) always remain readable.

# **7. Suggested Optimizations (Remaining)**

Most previous suggestions are now built into the spec as firm requirements. Two genuinely optional ideas remain:

- Show a simple visual timeline (not just a text log) for the per-document audit trail (Section 5.5) — low additional effort given the data is already captured, and it reads faster than a table for a short chain.

- In a future phase, allow a Default Approver entry beyond the mandatory two to be marked “required” vs “optional” for a company — not needed for v1, but worth keeping in mind since it fits cleanly into the current Company Master design later.

# **8. Confirmed Decisions ****&**** Remaining Open Questions**

## **8.****1**** Still open — please confirm with client**

- Since Role Master no longer distinguishes an “Approver” category from other roles, should the Company Master's Default Approvers picker restrict selection to certain employees, or can Admin add any Employee Master record (including one labelled Creator/CFO/Admin) as an approver?

- Can a rejected workflow be edited and resubmitted by the Creator, or must a rejected document always be uploaded as a brand-new submission?

- Should an approver be able to reassign or delegate their pending approval to someone else (e.g. out-of-office cover)?

- Is a due-date / SLA reminder (e.g. "pending 3+ days") required for v1, or can it wait for a later phase?

- File type and size restrictions for the uploaded document (e.g. PDF only, max 10 MB) — to be confirmed.

# **9. Out of Scope (v1)**

- Parallel/multi-branch approvals (only sequential, ordered approval is covered).

- Document editing or versioning after upload.

- Resubmission workflow after rejection (pending confirmation in Section 8.2).

- Mobile app; this spec assumes a responsive web application.

- Analytics-style reporting: charts, exports, and summary statistics beyond the structured Admin Dashboard list in Section 5.8.

# **10. Appendix: Workflow Summary (Text Form)**

**Creator uploads document → searches and selects Company (Name or Code) → Default Approvers auto-populate in the company's set order (min. 2, CFO always shown, locked, last) → Creator may search and add extra approver(s) by name and/or reorder the chain, for this document only, with a Reset to Company Default available → Submit (order snapshotted).**

At each step, the current approver sees the full history so far (created by, and every prior approval with remarks). Approver at position N reviews →

- Approve (remarks optional) → goes to the next position, or to CFO if this was the last approver position

- Reject (reason mandatory) → workflow ends → Creator notified by email with reason

CFO reviews (sees complete chain history) →

- Approve (remarks optional) → workflow Completed → Creator notified by email

- Reject (reason mandatory) → workflow ends → Creator notified by email with reason

Separately, Admin can open the Dashboard (Section 5.8) at any time to view, filter, and drill into every workflow across every company and status.