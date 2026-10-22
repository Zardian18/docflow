import { z } from 'zod';
import type { Slot, Team } from './people.js';

/**
 * Workflow templates (docs/v2-gap-analysis.md §4.3). A template is data: the steps, who holds
 * them, loops, gates and dependencies. The engine implements a fixed set of step kinds and
 * walks whatever graph the template describes. Orders pin the template version they started
 * on, so changing a template never changes an order in progress (D24).
 *
 * To change the workflow: add a new version here (keep the old one while orders use it).
 */

export type Actor = { team: Team } | { slot: Slot };

export const DOC_KINDS = [
  'CBM',
  'PI_FULL',
  'PI_NO_RATES',
  'ANNEXURE',
  'ARTWORK',
  'QA_NOTE',
  'INVOICE',
  'PAYMENT_PROOF',
  'BOL',
] as const;
export const DocKind = z.enum(DOC_KINDS);
export type DocKind = z.infer<typeof DocKind>;

export const DOC_KIND_LABEL: Record<DocKind, string> = {
  CBM: 'CBM',
  PI_FULL: 'PI (full)',
  PI_NO_RATES: 'PI (without rates)',
  ANNEXURE: 'Packaging annexure',
  ARTWORK: 'Artwork',
  QA_NOTE: 'QA attachment',
  INVOICE: 'Invoice',
  PAYMENT_PROOF: 'Payment proof',
  BOL: 'Bill of Lading',
};

/** The separate back-and-forth channels, each queryable on its own (brief, cross-cutting 2). */
export const CHANNELS = [
  'CBM',
  'ANNEXURE',
  'ARTWORK',
  'PRODUCTION_QA',
  'CONTAINER',
  'INVOICE',
] as const;
export const Channel = z.enum(CHANNELS);
export type Channel = z.infer<typeof Channel>;

export const CHANNEL_LABEL: Record<Channel, string> = {
  CBM: 'CBM revisions',
  ANNEXURE: 'Annexure revisions',
  ARTWORK: 'Artwork revisions',
  PRODUCTION_QA: 'Production QA',
  CONTAINER: 'Container sizing',
  INVOICE: 'Invoice packaging',
};

export const TAGS = ['RAW_MATERIAL', 'PACKAGING'] as const;
export const Tag = z.enum(TAGS);
export type Tag = z.infer<typeof Tag>;
export const TAG_LABEL: Record<Tag, string> = {
  RAW_MATERIAL: 'Raw material',
  PACKAGING: 'Packaging',
};

/** What completing a step does to the order itself */
export type Effect = 'START_CHAIN' | 'START_PRODUCTION' | 'NO_ACTION_NEEDED' | 'DONE';

/** Extra input a step asks for, beyond a comment */
export type Form = 'PRODUCTS' | 'PAYMENT' | 'DATE';

interface StepBase {
  key: string;
  phase: 1 | 2 | 3;
  title: string;
  /** One sentence for the person doing it */
  help: string;
  /** Steps that must be done first (all of them). Same-product matching for per-product steps. */
  after: string[];
  /** One task per product on the order */
  perProduct?: boolean;
  tag?: Tag;
  effect?: Effect;
}

export interface TaskStep extends StepBase {
  kind: 'TASK';
  actor: Actor;
  actionLabel: string;
  docs?: Array<{ kind: DocKind; required: boolean }>;
  form?: Form;
  paymentKind?: 'ADVANCE' | 'BALANCE';
  /** Completing needs at least one component of this type for the task's product (D27) */
  needsComponents?: Tag;
}

export interface ReviewLoopStep extends StepBase {
  kind: 'REVIEW_LOOP';
  channel: Channel;
  /** Who sends work for review. Several = the reviewer picks who gets it back (Production QA). */
  submitters: Actor[];
  reviewer: Actor;
  /** Most loops start with a submission; Production QA starts with the reviewer inspecting. */
  startsWith: 'SUBMITTER' | 'REVIEWER';
  doc?: DocKind;
  submitLabel: string;
  confirmLabel: string;
}

export interface ApprovalStage {
  key: string;
  title: string;
  actor: Actor;
  /** Accounts records the payment while approving */
  form?: Form;
  paymentKind?: 'ADVANCE' | 'BALANCE';
}

export interface ApprovalChainStep extends StepBase {
  kind: 'APPROVAL_CHAIN';
  stages: ApprovalStage[];
  /** A rejection reopens that step (which then re-runs this chain), or restarts this chain */
  onReject: { reopen: string } | 'RESTART';
  docToApprove?: DocKind[];
}

export interface StatusLogStep extends StepBase {
  kind: 'STATUS_LOG';
  actor: Actor;
  actionLabel: string;
  form?: 'DATE';
}

/**
 * ALL_COMPONENTS_DELIVERED: every component has a Deliver Date (template v1).
 * ALL_COMPONENTS_COMPLETE: every component has all its dates, Challan No. and LR Details (D27).
 */
export type DataGateCondition = 'ALL_COMPONENTS_DELIVERED' | 'ALL_COMPONENTS_COMPLETE';

export interface DataGateStep extends StepBase {
  kind: 'DATA_GATE';
  condition: DataGateCondition;
}

export interface CheckpointLogStep extends StepBase {
  kind: 'CHECKPOINT_LOG';
  actor: Actor;
  /** Stays open for entries until this step completes */
  closesWith: string;
}

export interface CloseStep extends StepBase {
  kind: 'CLOSE';
  actor: Actor;
  actionLabel: string;
}

export type StepDef =
  | TaskStep
  | ReviewLoopStep
  | ApprovalChainStep
  | StatusLogStep
  | DataGateStep
  | CheckpointLogStep
  | CloseStep;

export interface Template {
  key: string;
  version: number;
  name: string;
  steps: StepDef[];
  /** Which teams may open each document kind. Named people on the order and Admin see all. */
  docAccess: Record<DocKind, Team[]>;
  /** From which phase a team can see an order (and its component tables) */
  teamVisibleFrom: Record<Team, 1 | 2 | 3>;
  /**
   * Comments on steps of these phases are hidden from people who see the order only through
   * these teams (D28). They still see the steps, who acted and when.
   */
  commentPrivacy: { phases: Array<1 | 2 | 3>; hiddenFromTeams: Team[] };
  /** Materials can edit component rows until this step is done */
  componentsEditableUntil: string;
}

export const SHIPMENT_STATUSES = [
  'SAILED',
  'IN_TRANSIT',
  'DELAYED',
  'AT_PORT',
  'CUSTOMS',
  'OUT_FOR_DELIVERY',
  'OTHER',
] as const;
export const ShipmentStatus = z.enum(SHIPMENT_STATUSES);
export type ShipmentStatus = z.infer<typeof ShipmentStatus>;
export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  SAILED: 'Sailed',
  IN_TRANSIT: 'In transit',
  DELAYED: 'Delayed',
  AT_PORT: 'At port',
  CUSTOMS: 'Customs',
  OUT_FOR_DELIVERY: 'Out for delivery',
  OTHER: 'Other',
};

const team = (t: Team): Actor => ({ team: t });
const slot = (s: Slot): Actor => ({ slot: s });

/** The export-order workflow as reviewed by the owner (docs/v2-workflow.md, D24). */
export const EXPORT_ORDER_V1: Template = {
  key: 'export-order',
  version: 1,
  name: 'Export order',
  steps: [
    // ---- Phase 1 · Sales and Proforma Invoice
    {
      key: 'cbm',
      kind: 'REVIEW_LOOP',
      phase: 1,
      title: 'CBM',
      help: 'The Creator uploads the CBM; Marketing confirms it or sends it back with comments.',
      after: [],
      channel: 'CBM',
      submitters: [slot('CREATOR')],
      reviewer: slot('MARKETING'),
      startsWith: 'SUBMITTER',
      doc: 'CBM',
      submitLabel: 'Send CBM to Marketing',
      confirmLabel: 'Confirm CBM',
    },
    {
      key: 'cbm_buyer_confirmed',
      kind: 'STATUS_LOG',
      phase: 1,
      title: 'Buyer confirmed the CBM',
      help: 'Log when the buyer confirmed the CBM. This starts the order’s clock.',
      after: ['cbm'],
      actor: slot('MARKETING'),
      actionLabel: 'Buyer confirmed CBM',
      form: 'DATE',
      effect: 'START_CHAIN',
    },
    {
      key: 'pi',
      kind: 'TASK',
      phase: 1,
      title: 'Proforma Invoice',
      help: 'Upload the full PI and the version without rates, buyer name or address, and list the products.',
      after: ['cbm_buyer_confirmed'],
      actor: slot('CREATOR'),
      actionLabel: 'Submit PI for approval',
      docs: [
        { kind: 'PI_FULL', required: true },
        { kind: 'PI_NO_RATES', required: true },
      ],
      form: 'PRODUCTS',
    },
    {
      key: 'pi_approval',
      kind: 'APPROVAL_CHAIN',
      phase: 1,
      title: 'PI approval',
      help: 'Marketing, then the Approver, then the Head Approver(s). A rejection returns the PI to the Creator.',
      after: ['pi'],
      stages: [
        { key: 'marketing', title: 'Marketing', actor: slot('MARKETING') },
        { key: 'approver', title: 'Approver', actor: slot('PI_APPROVER') },
        { key: 'head', title: 'Head Approver', actor: slot('PI_HEAD') },
      ],
      onReject: { reopen: 'pi' },
      docToApprove: ['PI_FULL', 'PI_NO_RATES'],
    },
    {
      key: 'advance_requested',
      kind: 'STATUS_LOG',
      phase: 1,
      title: 'PI sent, advance requested',
      help: 'Log that the PI went to the buyer and the advance payment was requested.',
      after: ['pi_approval'],
      actor: slot('MARKETING'),
      actionLabel: 'Advance requested',
      form: 'DATE',
    },
    {
      key: 'advance_verified',
      kind: 'TASK',
      phase: 1,
      title: 'Advance payment verified',
      help: 'Confirm the advance arrived. This starts production.',
      after: ['advance_requested'],
      actor: team('ACCOUNTS'),
      actionLabel: 'Verify advance',
      form: 'PAYMENT',
      paymentKind: 'ADVANCE',
      docs: [{ kind: 'PAYMENT_PROOF', required: false }],
      effect: 'START_PRODUCTION',
    },
    // ---- Phase 2 · Production
    {
      key: 'raw_material',
      kind: 'TASK',
      phase: 2,
      title: 'Order raw material',
      help: 'Order the raw materials (API) for this product, then fill in the component table.',
      after: ['advance_verified'],
      perProduct: true,
      tag: 'RAW_MATERIAL',
      actor: team('MATERIALS'),
      actionLabel: 'Raw material ordered',
    },
    {
      key: 'annexure',
      kind: 'REVIEW_LOOP',
      phase: 2,
      title: 'Packaging annexure',
      help: 'Materials drafts the packaging annexure; Regulation confirms it or returns it.',
      after: ['advance_verified'],
      perProduct: true,
      tag: 'PACKAGING',
      channel: 'ANNEXURE',
      submitters: [team('MATERIALS')],
      reviewer: team('REGULATION'),
      startsWith: 'SUBMITTER',
      doc: 'ANNEXURE',
      submitLabel: 'Send annexure to Regulation',
      confirmLabel: 'Confirm annexure',
    },
    {
      key: 'artwork',
      kind: 'REVIEW_LOOP',
      phase: 2,
      title: 'Artwork',
      help: 'Design sends the updated artwork; Regulation confirms it or returns it.',
      after: ['advance_verified'],
      perProduct: true,
      channel: 'ARTWORK',
      submitters: [team('DESIGN')],
      reviewer: team('REGULATION'),
      startsWith: 'SUBMITTER',
      doc: 'ARTWORK',
      submitLabel: 'Send artwork to Regulation',
      confirmLabel: 'Confirm artwork',
    },
    {
      key: 'packaging',
      kind: 'TASK',
      phase: 2,
      title: 'Order packaging and print',
      help: 'The annexure and artwork are confirmed: order the packaging materials and start printing.',
      after: ['annexure', 'artwork'],
      perProduct: true,
      tag: 'PACKAGING',
      actor: team('MATERIALS'),
      actionLabel: 'Packaging ordered',
    },
    {
      key: 'materials_delivered',
      kind: 'DATA_GATE',
      phase: 2,
      title: 'All materials delivered',
      help: 'Completes by itself when every component of every product has a Deliver Date.',
      after: ['raw_material', 'packaging'],
      condition: 'ALL_COMPONENTS_DELIVERED',
    },
    {
      key: 'production_qa',
      kind: 'REVIEW_LOOP',
      phase: 2,
      title: 'Production QA',
      help: 'Production checks the materials and can send problems back to Materials or Design.',
      after: ['materials_delivered'],
      channel: 'PRODUCTION_QA',
      submitters: [team('MATERIALS'), team('DESIGN')],
      reviewer: team('PRODUCTION'),
      startsWith: 'REVIEWER',
      doc: 'QA_NOTE',
      submitLabel: 'Send back to Production',
      confirmLabel: 'Approve and hand over to Logistics',
    },
    // ---- Phase 3 · Logistics and shipment
    {
      key: 'container',
      kind: 'REVIEW_LOOP',
      phase: 3,
      title: 'Container sizing',
      help: 'Logistics sends the container and sizing details; Marketing confirms or returns them.',
      after: ['production_qa'],
      channel: 'CONTAINER',
      submitters: [team('LOGISTICS')],
      reviewer: slot('MARKETING'),
      startsWith: 'SUBMITTER',
      submitLabel: 'Send to Marketing',
      confirmLabel: 'Confirm container sizing',
    },
    {
      key: 'invoice',
      kind: 'REVIEW_LOOP',
      phase: 3,
      title: 'Invoice packaging',
      help: 'Logistics prepares the real invoice; Marketing confirms it or returns it.',
      after: ['container'],
      channel: 'INVOICE',
      submitters: [team('LOGISTICS')],
      reviewer: slot('MARKETING'),
      startsWith: 'SUBMITTER',
      doc: 'INVOICE',
      submitLabel: 'Send invoice to Marketing',
      confirmLabel: 'Confirm invoice',
    },
    {
      key: 'balance_requested',
      kind: 'STATUS_LOG',
      phase: 3,
      title: 'Remaining payment requested',
      help: 'Log that the buyer was asked for the remaining payment.',
      after: ['invoice'],
      actor: slot('MARKETING'),
      actionLabel: 'Remaining payment requested',
      form: 'DATE',
    },
    {
      key: 'payment_check',
      kind: 'APPROVAL_CHAIN',
      phase: 3,
      title: 'Payment check',
      help: 'Accounts confirms the money arrived, then Marketing, the Approver and the Head Approver(s) sign off.',
      after: ['balance_requested'],
      stages: [
        {
          key: 'accounts',
          title: 'Accounts',
          actor: team('ACCOUNTS'),
          form: 'PAYMENT',
          paymentKind: 'BALANCE',
        },
        { key: 'marketing', title: 'Marketing', actor: slot('MARKETING') },
        { key: 'approver', title: 'Approver', actor: slot('PAY_APPROVER') },
        { key: 'head', title: 'Head Approver', actor: slot('PAY_HEAD') },
      ],
      onReject: 'RESTART',
    },
    {
      key: 'sailed',
      kind: 'STATUS_LOG',
      phase: 3,
      title: 'Shipment sailed',
      help: 'Log when the shipment sailed. Tracking starts here.',
      after: ['payment_check'],
      actor: team('LOGISTICS'),
      actionLabel: 'Shipment sailed',
      form: 'DATE',
    },
    {
      key: 'tracking',
      kind: 'CHECKPOINT_LOG',
      phase: 3,
      title: 'Shipment updates',
      help: 'Post the route, delays and anything else, as often as needed until delivery.',
      after: ['sailed'],
      actor: team('LOGISTICS'),
      closesWith: 'delivered',
    },
    {
      key: 'bol_requested',
      kind: 'STATUS_LOG',
      phase: 3,
      title: 'Buyer asked for the BoL',
      help: 'Log when the buyer asks for the Bill of Lading. Only then is it created.',
      after: ['sailed'],
      actor: team('LOGISTICS'),
      actionLabel: 'Buyer asked for the BoL',
      form: 'DATE',
    },
    {
      key: 'bol',
      kind: 'TASK',
      phase: 3,
      title: 'Bill of Lading',
      help: 'Create the Bill of Lading and upload it for approval.',
      after: ['bol_requested'],
      actor: team('LOGISTICS'),
      actionLabel: 'Send BoL for approval',
      docs: [{ kind: 'BOL', required: true }],
    },
    {
      key: 'bol_approval',
      kind: 'APPROVAL_CHAIN',
      phase: 3,
      title: 'BoL approval',
      help: 'Accounts, Marketing, the Approver and the Head Approver(s). A rejection returns the BoL to Logistics.',
      after: ['bol'],
      stages: [
        { key: 'accounts', title: 'Accounts', actor: team('ACCOUNTS') },
        { key: 'marketing', title: 'Marketing', actor: slot('MARKETING') },
        { key: 'approver', title: 'Approver', actor: slot('BOL_APPROVER') },
        { key: 'head', title: 'Head Approver', actor: slot('BOL_HEAD') },
      ],
      onReject: { reopen: 'bol' },
      docToApprove: ['BOL'],
    },
    {
      key: 'bol_sent',
      kind: 'STATUS_LOG',
      phase: 3,
      title: 'BoL sent to the buyer',
      help: 'Log that the approved BoL was sent to the buyer.',
      after: ['bol_approval'],
      actor: team('LOGISTICS'),
      actionLabel: 'BoL sent to buyer',
      form: 'DATE',
      effect: 'NO_ACTION_NEEDED',
    },
    {
      key: 'delivered',
      kind: 'CLOSE',
      phase: 3,
      title: 'Delivered',
      help: 'Confirm the buyer received the goods. This closes the order.',
      after: ['bol_sent'],
      actor: team('LOGISTICS'),
      actionLabel: 'Buyer received the goods',
      effect: 'DONE',
    },
  ],
  docAccess: {
    CBM: [],
    PI_FULL: ['LOGISTICS', 'ACCOUNTS', 'PRODUCTION'],
    PI_NO_RATES: ['REGULATION', 'MATERIALS', 'DESIGN'],
    ANNEXURE: ['MATERIALS', 'REGULATION', 'DESIGN', 'PRODUCTION'],
    ARTWORK: ['DESIGN', 'REGULATION', 'MATERIALS', 'PRODUCTION'],
    QA_NOTE: ['PRODUCTION', 'MATERIALS', 'DESIGN'],
    INVOICE: ['LOGISTICS', 'ACCOUNTS'],
    PAYMENT_PROOF: ['ACCOUNTS'],
    BOL: ['LOGISTICS', 'ACCOUNTS'],
  },
  commentPrivacy: {
    phases: [1],
    hiddenFromTeams: ['REGULATION', 'DESIGN', 'MATERIALS', 'LOGISTICS'],
  },
  teamVisibleFrom: {
    ACCOUNTS: 1,
    REGULATION: 2,
    MATERIALS: 2,
    DESIGN: 2,
    PRODUCTION: 2,
    LOGISTICS: 2,
  },
  componentsEditableUntil: 'production_qa',
};

/**
 * v2 (D27): the ordering tasks need components listed first, the hand-over to Production
 * needs every component's dates, Challan No. and LR Details, and the payment proof is shown
 * to the people signing off the payment check.
 */
export const EXPORT_ORDER_V2: Template = {
  ...EXPORT_ORDER_V1,
  version: 2,
  steps: EXPORT_ORDER_V1.steps.map((step): StepDef => {
    if (step.kind === 'TASK' && step.key === 'raw_material') {
      return { ...step, needsComponents: 'RAW_MATERIAL' };
    }
    if (step.kind === 'TASK' && step.key === 'packaging') {
      return { ...step, needsComponents: 'PACKAGING' };
    }
    if (step.kind === 'DATA_GATE') {
      return {
        ...step,
        title: 'Materials complete',
        help: 'Completes by itself when every component of every product has its PO, Dispatch and Deliver Dates, Challan No. and LR Details.',
        condition: 'ALL_COMPONENTS_COMPLETE',
      };
    }
    if (step.kind === 'APPROVAL_CHAIN' && step.key === 'payment_check') {
      return { ...step, docToApprove: ['PAYMENT_PROOF'] };
    }
    return step;
  }),
};

export const TEMPLATES: Template[] = [EXPORT_ORDER_V1, EXPORT_ORDER_V2];
export const CURRENT_TEMPLATE = EXPORT_ORDER_V2;

export function findTemplate(key: string, version: number): Template {
  const t = TEMPLATES.find((x) => x.key === key && x.version === version);
  if (!t) throw new Error(`Unknown workflow template ${key} v${version}`);
  return t;
}

export function stepOf(template: Template, key: string): StepDef {
  const s = template.steps.find((x) => x.key === key);
  if (!s) throw new Error(`Unknown step ${key} in ${template.key} v${template.version}`);
  return s;
}

/** Structural checks, run in tests for every template (and so before any deploy). */
export function templateProblems(t: Template): string[] {
  const problems: string[] = [];
  const keys = t.steps.map((s) => s.key);
  if (new Set(keys).size !== keys.length) problems.push('step keys must be unique');
  const index = new Map(keys.map((k, i) => [k, i]));
  for (const s of t.steps) {
    for (const dep of s.after) {
      if (!index.has(dep)) problems.push(`${s.key}: unknown dependency ${dep}`);
      // Listed in an order where every dependency comes first, so the graph has no cycles
      else if (index.get(dep)! >= index.get(s.key)!)
        problems.push(`${s.key}: ${dep} must come before it`);
      const d = t.steps.find((x) => x.key === dep);
      if (d && d.phase > s.phase) problems.push(`${s.key}: depends on a later phase`);
    }
    if (s.kind === 'APPROVAL_CHAIN') {
      if (s.stages.length === 0) problems.push(`${s.key}: no stages`);
      if (s.onReject !== 'RESTART') {
        const target = s.onReject.reopen;
        if (!index.has(target) || index.get(target)! >= index.get(s.key)!) {
          problems.push(`${s.key}: rejection must reopen an earlier step`);
        }
      }
      if (s.perProduct) problems.push(`${s.key}: approval chains are per order`);
    }
    if (s.kind === 'REVIEW_LOOP' && s.submitters.length === 0)
      problems.push(`${s.key}: no submitters`);
    if (s.kind === 'CHECKPOINT_LOG' && !index.has(s.closesWith)) {
      problems.push(`${s.key}: closes with an unknown step`);
    }
    if (s.after.length === 0 && s !== t.steps[0])
      problems.push(`${s.key}: only the first step has no dependencies`);
  }
  if (!index.has(t.componentsEditableUntil)) problems.push('componentsEditableUntil is not a step');
  return problems;
}
