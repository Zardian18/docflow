import { z } from 'zod';
import { CompanyOption, SlotInput } from './masters.js';
import { Gate, Slot, Team } from './people.js';
import { Channel, DocKind, ShipmentStatus, Tag } from './template.js';

const Instant = z.iso.datetime({ offset: true });
const LocalDate = z.iso.date();
const Comment = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => (v === '' ? null : v))
  .nullable()
  .optional()
  .default(null);

export const ORDER_STATUSES = ['ACTIVE', 'NO_ACTION_NEEDED', 'DONE', 'CANCELLED'] as const;
export const OrderStatus = z.enum(ORDER_STATUSES);
export type OrderStatus = z.infer<typeof OrderStatus>;
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  ACTIVE: 'In progress',
  NO_ACTION_NEEDED: 'No Action Needed',
  DONE: 'Done',
  CANCELLED: 'Cancelled',
};

export const TASK_STATUSES = ['WAITING', 'OPEN', 'DONE', 'CANCELLED'] as const;
export const TaskStatus = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof TaskStatus>;

/** A day-counter, always with the moment it counts from (brief, cross-cutting 3) */
export const Clock = z.object({ days: z.number().int().nonnegative(), since: Instant }).nullable();
export type Clock = z.infer<typeof Clock>;

export const orderRef = (n: number) => `ORD-${String(n).padStart(4, '0')}`;

// ---- Creating an order (Q2: Marketing; Q61: named people may be changed for this order) ----

export const OrderCreate = z.object({
  buyerId: z.uuid('Choose a buyer'),
  companyId: z.uuid('Choose a company'),
  notes: z
    .string()
    .trim()
    .max(2000)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .default(null),
  /** Overrides of the company's named people for this order; gates always come from the company */
  slots: z
    .array(SlotInput.omit({ gate: true }))
    .max(20)
    .default([]),
});
export type OrderCreate = z.input<typeof OrderCreate>;

// ---- Reading orders ----------------------------------------------------------

export const Holder = z.object({
  team: Team.nullable(),
  slot: Slot.nullable(),
  label: z.string(),
  /** Named people on the slot, for a slot holder */
  people: z.array(z.string()),
});
export type Holder = z.infer<typeof Holder>;

export const OrderSummary = z.object({
  id: z.uuid(),
  number: z.number().int(),
  buyerName: z.string(),
  company: CompanyOption,
  status: OrderStatus,
  phase: z.number().int().min(1).max(3),
  /** Titles of the steps open right now */
  current: z.array(z.string()),
  trackerA: Clock,
  trackerB: Clock,
  createdAt: Instant,
  updatedAt: Instant,
});
export type OrderSummary = z.infer<typeof OrderSummary>;

export const ORDER_SORTS = [
  'updated',
  'created',
  'number',
  'buyer',
  'trackerA',
  'trackerB',
] as const;
export const OrderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: OrderStatus.optional(),
  phase: z.coerce.number().int().min(1).max(3).optional(),
  buyerId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  stepKey: z.string().max(60).optional(),
  createdFrom: Instant.optional(),
  createdTo: Instant.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(ORDER_SORTS).default('updated'),
  dir: z.enum(['asc', 'desc']).default('desc'),
});
export type OrderListQuery = z.input<typeof OrderListQuery>;

export const TaskView = z.object({
  id: z.uuid(),
  stepKey: z.string(),
  title: z.string(),
  kind: z.string(),
  phase: z.number().int(),
  productId: z.uuid().nullable(),
  productName: z.string().nullable(),
  status: TaskStatus,
  tag: Tag.nullable(),
  /** Review loop: SUBMITTER/REVIEWER. Approval chain: the stage key */
  side: z.string().nullable(),
  run: z.number().int(),
  holder: Holder.nullable(),
  openedAt: Instant.nullable(),
  /** When the current holder got it */
  waitingSince: Instant.nullable(),
  doneAt: Instant.nullable(),
  doneByName: z.string().nullable(),
  /** Tracker C for the current holder (time they have held it in total) */
  held: Clock,
  /** What the signed-in person can do on it now */
  actions: z.array(z.string()),
});
export type TaskView = z.infer<typeof TaskView>;

export const OrderDocument = z.object({
  id: z.uuid(),
  kind: DocKind,
  fileName: z.string(),
  fileMime: z.string(),
  fileSize: z.number().int(),
  uploadedByName: z.string(),
  uploadedAt: Instant,
  taskId: z.uuid().nullable(),
  roundId: z.uuid().nullable(),
});
export type OrderDocument = z.infer<typeof OrderDocument>;

export const ChannelRound = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  channel: Channel,
  round: z.number().int(),
  productName: z.string().nullable(),
  submittedByName: z.string().nullable(),
  submittedAt: Instant.nullable(),
  submitComment: z.string().nullable(),
  verdict: z.enum(['CONFIRMED', 'RETURNED']).nullable(),
  verdictByName: z.string().nullable(),
  verdictAt: Instant.nullable(),
  verdictComment: z.string().nullable(),
  returnedToTeam: Team.nullable(),
});
export type ChannelRound = z.infer<typeof ChannelRound>;

export const ApprovalVote = z.object({
  taskId: z.uuid(),
  run: z.number().int(),
  stage: z.string(),
  employeeName: z.string(),
  vote: z.enum(['APPROVE', 'REJECT']),
  comment: z.string().nullable(),
  at: Instant,
});
export type ApprovalVote = z.infer<typeof ApprovalVote>;

export const Payment = z.object({
  id: z.uuid(),
  kind: z.enum(['ADVANCE', 'BALANCE']),
  receivedOn: LocalDate,
  amount: z.string(),
  currency: z.string(),
  reference: z.string().nullable(),
  verifiedByName: z.string(),
  verifiedAt: Instant,
  comment: z.string().nullable(),
});
export type Payment = z.infer<typeof Payment>;

export const Checkpoint = z.object({
  id: z.uuid(),
  status: ShipmentStatus,
  note: z.string().nullable(),
  happenedOn: LocalDate,
  loggedByName: z.string(),
  loggedAt: Instant,
});
export type Checkpoint = z.infer<typeof Checkpoint>;

export const OrderSlot = z.object({
  slot: Slot,
  people: z.array(z.object({ id: z.uuid(), name: z.string() })),
  gate: Gate.nullable(),
});

export const OrderProduct = z.object({
  id: z.uuid(),
  name: z.string(),
  position: z.number().int(),
});

export const OrderDetail = OrderSummary.extend({
  notes: z.string().nullable(),
  createdByName: z.string(),
  templateVersion: z.number().int(),
  closedAt: Instant.nullable(),
  cancelReason: z.string().nullable(),
  slots: z.array(OrderSlot),
  products: z.array(OrderProduct),
  tasks: z.array(TaskView),
  documents: z.array(OrderDocument),
  rounds: z.array(ChannelRound),
  votes: z.array(ApprovalVote),
  payments: z.array(Payment),
  checkpoints: z.array(Checkpoint),
  canEditComponents: z.boolean(),
  canCancel: z.boolean(),
  canSeeComponents: z.boolean(),
});
export type OrderDetail = z.infer<typeof OrderDetail>;

// ---- Acting on a task ----------------------------------------------------------

export const TASK_ACTIONS = [
  'COMPLETE',
  'SUBMIT',
  'CONFIRM',
  'RETURN',
  'APPROVE',
  'REJECT',
  'LOG',
  'CHECKPOINT',
  'CLOSE',
] as const;
export const TaskAction = z.enum(TASK_ACTIONS);
export type TaskAction = z.infer<typeof TaskAction>;

export const PaymentInput = z.object({
  receivedOn: LocalDate,
  amount: z
    .string()
    .trim()
    .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount, e.g. 125000.50'),
  currency: z.string().trim().toUpperCase().length(3, 'Use a 3-letter code, e.g. USD'),
  reference: z
    .string()
    .trim()
    .max(120)
    .transform((v) => (v === '' ? null : v))
    .nullable()
    .optional()
    .default(null),
});
export type PaymentInput = z.input<typeof PaymentInput>;

/** One body for every task action; the engine checks which fields each step needs. */
export const TaskActionRequest = z.object({
  action: TaskAction,
  comment: Comment,
  /** Files uploaded first with /uploads/presign, attached as documents of these kinds */
  uploads: z
    .array(z.object({ uploadId: z.uuid(), kind: DocKind }))
    .max(10)
    .default([]),
  /** The PI task: the order's products, in order */
  products: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  payment: PaymentInput.optional(),
  /** Status logs and checkpoints: when it happened (defaults to today) */
  date: LocalDate.optional(),
  /** Production QA returns: which team gets it back */
  toTeam: Team.optional(),
  shipmentStatus: ShipmentStatus.optional(),
});
export type TaskActionRequest = z.input<typeof TaskActionRequest>;

export const CancelOrderRequest = z.object({
  reason: z.string().trim().min(1, 'Give a reason').max(1000),
});

export const ReplaceSlotPersonRequest = z.object({
  slot: Slot,
  fromEmployeeId: z.uuid(),
  toEmployeeId: z.uuid(),
  reason: z.string().trim().min(1, 'Give a reason').max(1000),
});

// ---- Dashboards (Q8, Q53, Q54) ----------------------------------------------------

export const WorkItem = z.object({
  taskId: z.uuid(),
  orderId: z.uuid(),
  orderNumber: z.number().int(),
  buyerName: z.string(),
  companyName: z.string(),
  stepKey: z.string(),
  title: z.string(),
  phase: z.number().int(),
  productName: z.string().nullable(),
  tag: Tag.nullable(),
  /** The team or slot this sits with you as */
  as: z.object({ team: Team.nullable(), slot: Slot.nullable(), label: z.string() }),
  waitingSince: Instant,
  held: Clock,
  trackerA: Clock,
  trackerB: Clock,
  actions: z.array(z.string()),
});
export type WorkItem = z.infer<typeof WorkItem>;

export const WORK_SORTS = ['waiting', 'held', 'order', 'buyer', 'trackerA', 'trackerB'] as const;
export const WorkQuery = z.object({
  /** A team, or "NAMED" for slot work; all when absent */
  tab: z.union([Team, z.literal('NAMED')]).optional(),
  buyerId: z.uuid().optional(),
  companyId: z.uuid().optional(),
  stepKey: z.string().max(60).optional(),
  tag: Tag.optional(),
  since: Instant.optional(),
  until: Instant.optional(),
  q: z.string().trim().max(100).optional(),
  sort: z.enum(WORK_SORTS).default('waiting'),
  // Oldest first: the longest-waiting task is at the top (brief, cross-cutting 4)
  dir: z.enum(['asc', 'desc']).default('asc'),
});
export type WorkQuery = z.input<typeof WorkQuery>;

export const WorkResponse = z.object({
  items: z.array(WorkItem),
  /** Counts per tab, unfiltered */
  tabs: z.array(z.object({ tab: z.string(), label: z.string(), count: z.number().int() })),
  buyers: z.array(z.object({ id: z.uuid(), name: z.string() })),
  companies: z.array(z.object({ id: z.uuid(), name: z.string() })),
});
export type WorkResponse = z.infer<typeof WorkResponse>;

// ---- Component tables (brief Phase 2, D24 field list) ---------------------------------

export const COMPONENT_FIELDS = [
  'name',
  'kind',
  'poQuantity',
  'orderQuantity',
  'poDate',
  'dispatchDate',
  'deliverDate',
  'lrDetails',
  'challanNo',
  'tridentRemark',
  'tnsRemark',
] as const;
export type ComponentField = (typeof COMPONENT_FIELDS)[number];

export const COMPONENT_FIELD_LABEL: Record<ComponentField, string> = {
  name: 'Prod Name',
  kind: 'Type',
  poQuantity: 'PO Quantity',
  orderQuantity: 'Order Quantity',
  poDate: 'PO Date',
  dispatchDate: 'Dispatch Date',
  deliverDate: 'Deliver Date',
  lrDetails: 'LR Details',
  challanNo: 'Challan No.',
  tridentRemark: 'Trident Remark',
  tnsRemark: 'TNS Remark',
};

const OptText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === '' ? null : v))
    .nullable();
const OptDate = LocalDate.nullable();

export const Component = z.object({
  id: z.uuid(),
  productId: z.uuid(),
  srNo: z.number().int(),
  name: z.string(),
  kind: Tag,
  poQuantity: z.string().nullable(),
  orderQuantity: z.string().nullable(),
  poDate: LocalDate.nullable(),
  dispatchDate: LocalDate.nullable(),
  deliverDate: LocalDate.nullable(),
  lrDetails: z.string().nullable(),
  challanNo: z.string().nullable(),
  tridentRemark: z.string().nullable(),
  tnsRemark: z.string().nullable(),
  /** Days since PO Date, until delivered (C5) */
  daysSincePo: z.number().int().nullable(),
  delivered: z.boolean(),
  updatedAt: Instant,
});
export type Component = z.infer<typeof Component>;

export const ComponentInput = z.object({
  name: z.string().trim().min(1, 'Required').max(160),
  kind: Tag,
  poQuantity: OptText(60).optional(),
  orderQuantity: OptText(60).optional(),
  poDate: OptDate.optional(),
  dispatchDate: OptDate.optional(),
  deliverDate: OptDate.optional(),
  lrDetails: OptText(200).optional(),
  challanNo: OptText(80).optional(),
  tridentRemark: OptText(1000).optional(),
  tnsRemark: OptText(1000).optional(),
  /** Why, kept with the change in the row's history */
  comment: Comment,
});
export type ComponentInput = z.input<typeof ComponentInput>;

export const ComponentTables = z.object({
  products: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      position: z.number().int(),
      components: z.array(Component),
      delivered: z.number().int(),
      total: z.number().int(),
    }),
  ),
  editable: z.boolean(),
  trackerA: Clock,
  trackerB: Clock,
});
export type ComponentTables = z.infer<typeof ComponentTables>;

export const ComponentChange = z.object({
  id: z.uuid(),
  field: z.string(),
  oldValue: z.string().nullable(),
  newValue: z.string().nullable(),
  comment: z.string().nullable(),
  actorName: z.string(),
  at: Instant,
});
export type ComponentChange = z.infer<typeof ComponentChange>;

// ---- Timeline (brief, cross-cutting 5) ---------------------------------------------

export const OrderEvent = z.object({
  id: z.uuid(),
  type: z.string(),
  stepKey: z.string().nullable(),
  taskId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  actingAs: z.string().nullable(),
  comment: z.string().nullable(),
  details: z.record(z.string(), z.unknown()),
  at: Instant,
});
export type OrderEvent = z.infer<typeof OrderEvent>;
