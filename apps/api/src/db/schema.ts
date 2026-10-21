import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { CAPABILITIES, CHANNELS, DOC_KINDS, GATES, SLOTS, TAGS, TEAMS } from '@docflow/shared';

const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`gen_random_uuid()`);
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
// clock_timestamp(), not now(): several rows in one transaction keep their order
const happenedAt = (name: string) =>
  timestamp(name, { withTimezone: true })
    .notNull()
    .default(sql`clock_timestamp()`);

export const passwordTokenPurpose = pgEnum('password_token_purpose', ['SET', 'RESET']);

// ---- People (D24: teams are pools, capabilities are what someone may be named as) ----------

export const teamEnum = pgEnum('team', TEAMS);
export const capabilityEnum = pgEnum('capability', CAPABILITIES);
export const slotEnum = pgEnum('slot', SLOTS);
export const gateEnum = pgEnum('gate', GATES);

export const employees = pgTable(
  'employees',
  {
    id: id(),
    // Optional display/search field; login is by email (D4). Stored uppercase.
    employeeCode: text('employee_code'),
    name: text('name').notNull(),
    // Stored lowercase; the login identifier
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('employees_email_unique').on(t.email),
    uniqueIndex('employees_code_unique').on(t.employeeCode),
    index('employees_name_lower_idx').on(sql`lower(${t.name}) text_pattern_ops`),
  ],
);

/** Any number of teams per person, with no exclusions (D24 retires D23). */
export const teamMembers = pgTable(
  'team_members',
  {
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    team: teamEnum('team').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.employeeId, t.team] }),
    index('team_members_team_idx').on(t.team),
  ],
);

export const employeeCapabilities = pgTable(
  'employee_capabilities',
  {
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    capability: capabilityEnum('capability').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.employeeId, t.capability] }),
    index('employee_capabilities_capability_idx').on(t.capability),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ip: text('ip'),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_employee_idx').on(t.employeeId),
  ],
);

export const passwordTokens = pgTable(
  'password_tokens',
  {
    id: id(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    tokenHash: text('token_hash').notNull(),
    purpose: passwordTokenPurpose('purpose').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('password_tokens_hash_unique').on(t.tokenHash),
    index('password_tokens_employee_idx').on(t.employeeId),
  ],
);

// ---- Masters ----------------------------------------------------------------

export const buyers = pgTable(
  'buyers',
  {
    id: id(),
    name: text('name').notNull(),
    // Optional short code, stored uppercase
    code: text('code'),
    country: text('country'),
    address: text('address'),
    contact: text('contact'),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('buyers_name_lower_unique').on(sql`lower(${t.name})`),
    uniqueIndex('buyers_code_unique').on(t.code),
  ],
);

/** Who fills each named slot on a buyer's orders (Q60, D27), in order. */
export const buyerSlotPeople = pgTable(
  'buyer_slot_people',
  {
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    slot: slotEnum('slot').notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    ordinal: integer('ordinal').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.buyerId, t.slot, t.employeeId] }),
    index('buyer_slot_people_employee_idx').on(t.employeeId),
  ],
);

/** ALL/ANY per approval slot, per buyer. Missing = ALL. */
export const buyerSlotGates = pgTable(
  'buyer_slot_gates',
  {
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id, { onDelete: 'cascade' }),
    slot: slotEnum('slot').notNull(),
    gate: gateEnum('gate').notNull(),
  },
  (t) => [primaryKey({ columns: [t.buyerId, t.slot] })],
);

/** A presigned upload, before it is attached to an order as a document. */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey(),
    objectKey: text('object_key').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    fileName: text('file_name').notNull(),
    fileMime: text('file_mime').notNull(),
    fileSize: integer('file_size').notNull(),
    createdAt: createdAt(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uploads_object_key_unique').on(t.objectKey),
    index('uploads_created_by_idx').on(t.createdBy),
  ],
);

// ---- Orders (the runtime of a workflow template) ------------------------------------------

export const orderStatusEnum = pgEnum('order_status', [
  'ACTIVE',
  'NO_ACTION_NEEDED',
  'DONE',
  'CANCELLED',
]);

export const orders = pgTable(
  'orders',
  {
    id: id(),
    // Running sequence; gives the first order number, ORD-0007
    number: integer('number').generatedAlwaysAsIdentity().notNull(),
    // The order number people use; the Creator can change it to the PI's (D27)
    ref: text('ref').notNull(),
    buyerId: uuid('buyer_id')
      .notNull()
      .references(() => buyers.id),
    // Pinned workflow template; editing a template never changes this order (D24)
    templateKey: text('template_key').notNull(),
    templateVersion: integer('template_version').notNull(),
    status: orderStatusEnum('status').notNull().default('ACTIVE'),
    notes: text('notes'),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => employees.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    // Tracker B anchor: the buyer confirmed the CBM (Q13)
    chainStartedAt: timestamp('chain_started_at', { withTimezone: true }),
    // Tracker A anchor: Accounts verified the advance (C3)
    productionStartedAt: timestamp('production_started_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
  },
  (t) => [
    uniqueIndex('orders_number_unique').on(t.number),
    uniqueIndex('orders_ref_lower_unique').on(sql`lower(${t.ref})`),
    index('orders_buyer_idx').on(t.buyerId),
    index('orders_status_idx').on(t.status),
  ],
);

/** The named people on this order, copied from the buyer at creation (Q61, D27) */
export const orderSlotPeople = pgTable(
  'order_slot_people',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    slot: slotEnum('slot').notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    ordinal: integer('ordinal').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.orderId, t.slot, t.employeeId] }),
    index('order_slot_people_employee_idx').on(t.employeeId),
  ],
);

export const orderSlotGates = pgTable(
  'order_slot_gates',
  {
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    slot: slotEnum('slot').notNull(),
    gate: gateEnum('gate').notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.slot] })],
);

export const orderProducts = pgTable(
  'order_products',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('order_products_order_idx').on(t.orderId, t.position)],
);

export const tagEnum = pgEnum('task_tag', TAGS);
export const taskStatusEnum = pgEnum('task_status', ['WAITING', 'OPEN', 'DONE', 'CANCELLED']);

/**
 * One task per step of the template, per product for per-product steps. `holder*` says who
 * has the ball right now; every change of holder is also a row in holder_intervals.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => orderProducts.id, { onDelete: 'cascade' }),
    stepKey: text('step_key').notNull(),
    // The step's phase, copied from the template, so visibility can be decided in SQL
    phase: integer('phase').notNull(),
    status: taskStatusEnum('status').notNull().default('WAITING'),
    tag: tagEnum('tag'),
    // Review loops: SUBMITTER or REVIEWER; approval chains: the stage key
    side: text('side'),
    // Approval chains: which run (a restart after a rejection is a new run)
    run: integer('run').notNull().default(1),
    holderTeam: teamEnum('holder_team'),
    holderSlot: slotEnum('holder_slot'),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: uuid('done_by').references(() => employees.id),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('tasks_step_unique').on(
      t.orderId,
      t.stepKey,
      sql`coalesce(${t.productId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
    ),
    index('tasks_open_team_idx')
      .on(t.holderTeam)
      .where(sql`${t.status} = 'OPEN'`),
    index('tasks_open_slot_idx')
      .on(t.holderSlot)
      .where(sql`${t.status} = 'OPEN'`),
    check(
      'tasks_one_holder',
      sql`not (${t.holderTeam} is not null and ${t.holderSlot} is not null)`,
    ),
  ],
);

/**
 * Every period a task sat with one holder. Source of Tracker C and of "waiting since".
 * `reason` says why it started: OPENED, RETURNED, SUBMITTED, NEXT_STAGE, RESTARTED, REOPENED.
 */
export const holderIntervals = pgTable(
  'holder_intervals',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    holderTeam: teamEnum('holder_team'),
    holderSlot: slotEnum('holder_slot'),
    reason: text('reason').notNull(),
    startedAt: happenedAt('started_at'),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [
    index('holder_intervals_task_idx').on(t.taskId, t.startedAt),
    uniqueIndex('holder_intervals_one_open')
      .on(t.taskId)
      .where(sql`${t.endedAt} is null`),
  ],
);

export const voteEnum = pgEnum('vote', ['APPROVE', 'REJECT']);

export const approvalVotes = pgTable(
  'approval_votes',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    run: integer('run').notNull(),
    stage: text('stage').notNull(),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id),
    vote: voteEnum('vote').notNull(),
    comment: text('comment'),
    createdAt: happenedAt('created_at'),
  },
  (t) => [uniqueIndex('approval_votes_once').on(t.taskId, t.run, t.stage, t.employeeId)],
);

export const channelEnum = pgEnum('channel', CHANNELS);
export const verdictEnum = pgEnum('verdict', ['CONFIRMED', 'RETURNED']);

/**
 * One round of a review loop: a submission (absent for a loop that starts with the reviewer)
 * and the reviewer's verdict. Queried per channel kind ("all annexure revisions").
 */
export const channelRounds = pgTable(
  'channel_rounds',
  {
    id: id(),
    taskId: uuid('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    channel: channelEnum('channel').notNull(),
    round: integer('round').notNull(),
    submittedBy: uuid('submitted_by').references(() => employees.id),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    submitComment: text('submit_comment'),
    verdict: verdictEnum('verdict'),
    verdictBy: uuid('verdict_by').references(() => employees.id),
    verdictAt: timestamp('verdict_at', { withTimezone: true }),
    verdictComment: text('verdict_comment'),
    // Production QA: which team the work went back to
    returnedToTeam: teamEnum('returned_to_team'),
  },
  (t) => [
    uniqueIndex('channel_rounds_unique').on(t.taskId, t.round),
    index('channel_rounds_order_channel_idx').on(t.orderId, t.channel),
  ],
);

export const docKindEnum = pgEnum('doc_kind', DOC_KINDS);

export const documents = pgTable(
  'documents',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    roundId: uuid('round_id').references(() => channelRounds.id, { onDelete: 'set null' }),
    kind: docKindEnum('kind').notNull(),
    fileKey: text('file_key').notNull(),
    fileName: text('file_name').notNull(),
    fileMime: text('file_mime').notNull(),
    fileSize: integer('file_size').notNull(),
    fileSha256: text('file_sha256').notNull(),
    uploadedBy: uuid('uploaded_by')
      .notNull()
      .references(() => employees.id),
    uploadedAt: happenedAt('uploaded_at'),
  },
  (t) => [
    index('documents_order_idx').on(t.orderId, t.kind),
    uniqueIndex('documents_file_key_unique').on(t.fileKey),
  ],
);

export const paymentKindEnum = pgEnum('payment_kind', ['ADVANCE', 'BALANCE']);

export const payments = pgTable(
  'payments',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    kind: paymentKindEnum('kind').notNull(),
    receivedOn: date('received_on').notNull(),
    amount: numeric('amount', { precision: 14, scale: 2 }).notNull(),
    currency: text('currency').notNull(),
    reference: text('reference'),
    verifiedBy: uuid('verified_by')
      .notNull()
      .references(() => employees.id),
    verifiedAt: happenedAt('verified_at'),
    comment: text('comment'),
  },
  (t) => [index('payments_order_idx').on(t.orderId)],
);

export const componentKindEnum = pgEnum('component_kind', TAGS);

/** The per-product tracking table (brief Phase 2, D24 field list). Delivered = deliver_date set. */
export const orderComponents = pgTable(
  'order_components',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => orderProducts.id, { onDelete: 'cascade' }),
    srNo: integer('sr_no').notNull(),
    name: text('name').notNull(),
    kind: componentKindEnum('kind').notNull(),
    poQuantity: text('po_quantity'),
    orderQuantity: text('order_quantity'),
    poDate: date('po_date'),
    dispatchDate: date('dispatch_date'),
    deliverDate: date('deliver_date'),
    lrDetails: text('lr_details'),
    challanNo: text('challan_no'),
    tridentRemark: text('trident_remark'),
    tnsRemark: text('tns_remark'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('order_components_product_idx').on(t.productId, t.srNo)],
);

/** Every edit to a component row: who, when, what changed (Q39) */
export const componentChanges = pgTable(
  'component_changes',
  {
    id: id(),
    componentId: uuid('component_id').notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    actorId: uuid('actor_id')
      .notNull()
      .references(() => employees.id),
    field: text('field').notNull(),
    oldValue: text('old_value'),
    newValue: text('new_value'),
    comment: text('comment'),
    createdAt: happenedAt('created_at'),
  },
  (t) => [index('component_changes_component_idx').on(t.componentId, t.createdAt)],
);

export const shipmentCheckpoints = pgTable(
  'shipment_checkpoints',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    note: text('note'),
    happenedOn: date('happened_on').notNull(),
    loggedBy: uuid('logged_by')
      .notNull()
      .references(() => employees.id),
    loggedAt: happenedAt('logged_at'),
  },
  (t) => [index('shipment_checkpoints_order_idx').on(t.orderId, t.loggedAt)],
);

/**
 * Everything tracked about an order: actor, what they acted as, when, comment, details.
 * Append-only (a trigger refuses UPDATE and DELETE, as v1's audit_events did).
 */
export const orderEvents = pgTable(
  'order_events',
  {
    id: id(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id),
    taskId: uuid('task_id'),
    stepKey: text('step_key'),
    actorId: uuid('actor_id').references(() => employees.id),
    // The team, slot or ADMIN the actor acted as
    actingAs: text('acting_as'),
    type: text('type').notNull(),
    comment: text('comment'),
    details: jsonb('details').notNull().default({}),
    createdAt: happenedAt('created_at'),
  },
  (t) => [index('order_events_order_idx').on(t.orderId, t.createdAt)],
);
