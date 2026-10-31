CREATE TYPE "public"."notice_kind" AS ENUM('PRIVATE_MESSAGE', 'PAYMENT_PROOF');--> statement-breakpoint
ALTER TYPE "public"."doc_kind" ADD VALUE 'PO';--> statement-breakpoint
CREATE TABLE "audience_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audience_id" uuid NOT NULL,
	"employee_id" uuid,
	"team" "team",
	"tagged" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"kind" "notice_kind" NOT NULL,
	"task_id" uuid,
	"title" text NOT NULL,
	"actor_id" uuid,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "approval_votes" ADD COLUMN "audience_id" uuid;--> statement-breakpoint
ALTER TABLE "channel_rounds" ADD COLUMN "submit_audience_id" uuid;--> statement-breakpoint
ALTER TABLE "channel_rounds" ADD COLUMN "verdict_audience_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "component_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "audience_id" uuid;--> statement-breakpoint
ALTER TABLE "order_events" ADD COLUMN "audience_id" uuid;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "audience_id" uuid;--> statement-breakpoint
ALTER TABLE "shipment_checkpoints" ADD COLUMN "audience_id" uuid;--> statement-breakpoint
ALTER TABLE "audience_members" ADD CONSTRAINT "audience_members_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_members" ADD CONSTRAINT "audience_members_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiences" ADD CONSTRAINT "audiences_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audiences" ADD CONSTRAINT "audiences_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_actor_id_employees_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audience_members_audience_idx" ON "audience_members" USING btree ("audience_id");--> statement-breakpoint
CREATE INDEX "audiences_order_idx" ON "audiences" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "notices_employee_idx" ON "notices" USING btree ("employee_id","read_at");--> statement-breakpoint
ALTER TABLE "approval_votes" ADD CONSTRAINT "approval_votes_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_rounds" ADD CONSTRAINT "channel_rounds_submit_audience_id_audiences_id_fk" FOREIGN KEY ("submit_audience_id") REFERENCES "public"."audiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_rounds" ADD CONSTRAINT "channel_rounds_verdict_audience_id_audiences_id_fk" FOREIGN KEY ("verdict_audience_id") REFERENCES "public"."audiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_component_id_order_components_id_fk" FOREIGN KEY ("component_id") REFERENCES "public"."order_components"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shipment_checkpoints" ADD CONSTRAINT "shipment_checkpoints_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE no action ON UPDATE no action;