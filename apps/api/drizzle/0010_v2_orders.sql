CREATE TYPE "public"."capability" AS ENUM('ADMIN', 'MARKETING', 'CREATOR', 'APPROVER', 'HEAD_APPROVER');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('CBM', 'ANNEXURE', 'ARTWORK', 'PRODUCTION_QA', 'CONTAINER', 'INVOICE');--> statement-breakpoint
CREATE TYPE "public"."component_kind" AS ENUM('RAW_MATERIAL', 'PACKAGING');--> statement-breakpoint
CREATE TYPE "public"."doc_kind" AS ENUM('CBM', 'PI_FULL', 'PI_NO_RATES', 'ANNEXURE', 'ARTWORK', 'QA_NOTE', 'INVOICE', 'PAYMENT_PROOF', 'BOL');--> statement-breakpoint
CREATE TYPE "public"."gate" AS ENUM('ALL', 'ANY');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('ACTIVE', 'NO_ACTION_NEEDED', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_kind" AS ENUM('ADVANCE', 'BALANCE');--> statement-breakpoint
CREATE TYPE "public"."slot" AS ENUM('MARKETING', 'CREATOR', 'PI_APPROVER', 'PI_HEAD', 'PAY_APPROVER', 'PAY_HEAD', 'BOL_APPROVER', 'BOL_HEAD');--> statement-breakpoint
CREATE TYPE "public"."task_tag" AS ENUM('RAW_MATERIAL', 'PACKAGING');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('WAITING', 'OPEN', 'DONE', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."team" AS ENUM('REGULATION', 'MATERIALS', 'DESIGN', 'PRODUCTION', 'ACCOUNTS', 'LOGISTICS');--> statement-breakpoint
CREATE TYPE "public"."verdict" AS ENUM('CONFIRMED', 'RETURNED');--> statement-breakpoint
CREATE TYPE "public"."vote" AS ENUM('APPROVE', 'REJECT');--> statement-breakpoint
CREATE TABLE "approval_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"run" integer NOT NULL,
	"stage" text NOT NULL,
	"employee_id" uuid NOT NULL,
	"vote" "vote" NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buyers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"country" text,
	"address" text,
	"contact" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"round" integer NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"submit_comment" text,
	"verdict" "verdict",
	"verdict_by" uuid,
	"verdict_at" timestamp with time zone,
	"verdict_comment" text,
	"returned_to_team" "team"
);
--> statement-breakpoint
CREATE TABLE "company_slot_gates" (
	"company_id" uuid NOT NULL,
	"slot" "slot" NOT NULL,
	"gate" "gate" NOT NULL,
	CONSTRAINT "company_slot_gates_company_id_slot_pk" PRIMARY KEY("company_id","slot")
);
--> statement-breakpoint
CREATE TABLE "company_slot_people" (
	"company_id" uuid NOT NULL,
	"slot" "slot" NOT NULL,
	"employee_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "company_slot_people_company_id_slot_employee_id_pk" PRIMARY KEY("company_id","slot","employee_id")
);
--> statement-breakpoint
CREATE TABLE "component_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"component_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"task_id" uuid,
	"round_id" uuid,
	"kind" "doc_kind" NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_mime" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_capabilities" (
	"employee_id" uuid NOT NULL,
	"capability" "capability" NOT NULL,
	CONSTRAINT "employee_capabilities_employee_id_capability_pk" PRIMARY KEY("employee_id","capability")
);
--> statement-breakpoint
CREATE TABLE "holder_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"holder_team" "team",
	"holder_slot" "slot",
	"reason" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "order_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"sr_no" integer NOT NULL,
	"name" text NOT NULL,
	"kind" "component_kind" NOT NULL,
	"po_quantity" text,
	"order_quantity" text,
	"po_date" date,
	"dispatch_date" date,
	"deliver_date" date,
	"lr_details" text,
	"challan_no" text,
	"trident_remark" text,
	"tns_remark" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"task_id" uuid,
	"step_key" text,
	"actor_id" uuid,
	"acting_as" text,
	"type" text NOT NULL,
	"comment" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_slot_gates" (
	"order_id" uuid NOT NULL,
	"slot" "slot" NOT NULL,
	"gate" "gate" NOT NULL,
	CONSTRAINT "order_slot_gates_order_id_slot_pk" PRIMARY KEY("order_id","slot")
);
--> statement-breakpoint
CREATE TABLE "order_slot_people" (
	"order_id" uuid NOT NULL,
	"slot" "slot" NOT NULL,
	"employee_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "order_slot_people_order_id_slot_employee_id_pk" PRIMARY KEY("order_id","slot","employee_id")
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "orders_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"buyer_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"template_key" text NOT NULL,
	"template_version" integer NOT NULL,
	"status" "order_status" DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"chain_started_at" timestamp with time zone,
	"production_started_at" timestamp with time zone,
	"closed_at" timestamp with time zone,
	"cancel_reason" text
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"task_id" uuid,
	"kind" "payment_kind" NOT NULL,
	"received_on" date NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text NOT NULL,
	"reference" text,
	"verified_by" uuid NOT NULL,
	"verified_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
	"comment" text
);
--> statement-breakpoint
CREATE TABLE "shipment_checkpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" text NOT NULL,
	"note" text,
	"happened_on" date NOT NULL,
	"logged_by" uuid NOT NULL,
	"logged_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"step_key" text NOT NULL,
	"phase" integer NOT NULL,
	"status" "task_status" DEFAULT 'WAITING' NOT NULL,
	"tag" "task_tag",
	"side" text,
	"run" integer DEFAULT 1 NOT NULL,
	"holder_team" "team",
	"holder_slot" "slot",
	"opened_at" timestamp with time zone,
	"done_at" timestamp with time zone,
	"done_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_one_holder" CHECK (not ("tasks"."holder_team" is not null and "tasks"."holder_slot" is not null))
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"employee_id" uuid NOT NULL,
	"team" "team" NOT NULL,
	CONSTRAINT "team_members_employee_id_team_pk" PRIMARY KEY("employee_id","team")
);
--> statement-breakpoint
ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_rounds" ADD CONSTRAINT "channel_rounds_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_rounds" ADD CONSTRAINT "channel_rounds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_rounds" ADD CONSTRAINT "channel_rounds_submitted_by_employees_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_rounds" ADD CONSTRAINT "channel_rounds_verdict_by_employees_id_fk" FOREIGN KEY ("verdict_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_slot_gates" ADD CONSTRAINT "company_slot_gates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_slot_people" ADD CONSTRAINT "company_slot_people_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_slot_people" ADD CONSTRAINT "company_slot_people_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_changes" ADD CONSTRAINT "component_changes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "component_changes" ADD CONSTRAINT "component_changes_actor_id_employees_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_round_id_channel_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."channel_rounds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_employees_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_capabilities" ADD CONSTRAINT "employee_capabilities_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holder_intervals" ADD CONSTRAINT "holder_intervals_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holder_intervals" ADD CONSTRAINT "holder_intervals_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_components" ADD CONSTRAINT "order_components_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_components" ADD CONSTRAINT "order_components_product_id_order_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."order_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_employees_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_products" ADD CONSTRAINT "order_products_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_slot_gates" ADD CONSTRAINT "order_slot_gates_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_slot_people" ADD CONSTRAINT "order_slot_people_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_slot_people" ADD CONSTRAINT "order_slot_people_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_verified_by_employees_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_checkpoints" ADD CONSTRAINT "shipment_checkpoints_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_checkpoints" ADD CONSTRAINT "shipment_checkpoints_logged_by_employees_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_product_id_order_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."order_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_done_by_employees_id_fk" FOREIGN KEY ("done_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_votes_once" ON "approval_votes" USING btree ("task_id","run","stage","employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buyers_name_lower_unique" ON "buyers" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "channel_rounds_unique" ON "channel_rounds" USING btree ("task_id","round");--> statement-breakpoint
CREATE INDEX "channel_rounds_order_channel_idx" ON "channel_rounds" USING btree ("order_id","channel");--> statement-breakpoint
CREATE INDEX "company_slot_people_employee_idx" ON "company_slot_people" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "component_changes_component_idx" ON "component_changes" USING btree ("component_id","created_at");--> statement-breakpoint
CREATE INDEX "documents_order_idx" ON "documents" USING btree ("order_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "documents_file_key_unique" ON "documents" USING btree ("file_key");--> statement-breakpoint
CREATE INDEX "employee_capabilities_capability_idx" ON "employee_capabilities" USING btree ("capability");--> statement-breakpoint
CREATE INDEX "holder_intervals_task_idx" ON "holder_intervals" USING btree ("task_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "holder_intervals_one_open" ON "holder_intervals" USING btree ("task_id") WHERE "holder_intervals"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "order_components_product_idx" ON "order_components" USING btree ("product_id","sr_no");--> statement-breakpoint
CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id","created_at");--> statement-breakpoint
CREATE INDEX "order_products_order_idx" ON "order_products" USING btree ("order_id","position");--> statement-breakpoint
CREATE INDEX "order_slot_people_employee_idx" ON "order_slot_people" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_unique" ON "orders" USING btree ("number");--> statement-breakpoint
CREATE INDEX "orders_buyer_idx" ON "orders" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "orders_company_idx" ON "orders" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipment_checkpoints_order_idx" ON "shipment_checkpoints" USING btree ("order_id","logged_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_step_unique" ON "tasks" USING btree ("order_id","step_key",coalesce("product_id", '00000000-0000-0000-0000-000000000000'::uuid));--> statement-breakpoint
CREATE INDEX "tasks_open_team_idx" ON "tasks" USING btree ("holder_team") WHERE "tasks"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "tasks_open_slot_idx" ON "tasks" USING btree ("holder_slot") WHERE "tasks"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "team_members_team_idx" ON "team_members" USING btree ("team");--> statement-breakpoint
INSERT INTO "employee_capabilities" ("employee_id", "capability")
SELECT "employee_id", 'ADMIN' FROM "v1_admins";--> statement-breakpoint
DROP TABLE "v1_admins";--> statement-breakpoint
-- Everything tracked about an order is append-only: any UPDATE or DELETE raises an error
CREATE OR REPLACE FUNCTION order_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'order_events is append-only (% not allowed)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;--> statement-breakpoint
CREATE TRIGGER order_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON "order_events"
  FOR EACH ROW EXECUTE FUNCTION order_events_append_only();
