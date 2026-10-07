CREATE TYPE "public"."step_status" AS ENUM('WAITING', 'PENDING', 'APPROVED', 'REJECTED', 'SKIPPED');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('PENDING_APPROVER', 'PENDING_CFO', 'COMPLETED', 'REJECTED');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"actor_id" uuid,
	"event_type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"object_key" text NOT NULL,
	"created_by" uuid NOT NULL,
	"file_name" text NOT NULL,
	"file_mime" text NOT NULL,
	"file_size" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "workflow_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workflow_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"employee_id" uuid NOT NULL,
	"employee_name" text NOT NULL,
	"employee_email" text NOT NULL,
	"is_cfo" boolean DEFAULT false NOT NULL,
	"status" "step_status" NOT NULL,
	"decided_at" timestamp with time zone,
	"remarks" text,
	CONSTRAINT "workflow_steps_position_positive" CHECK ("workflow_steps"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"upload_id" uuid NOT NULL,
	"title" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_mime" text NOT NULL,
	"file_size" integer NOT NULL,
	"file_sha256" text NOT NULL,
	"company_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"status" "workflow_status" NOT NULL,
	"current_position" integer NOT NULL,
	"chain_customised" boolean NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"invoice_number" text,
	"vendor_name" text,
	"invoice_date" date,
	"amount" numeric(14, 2),
	"currency" text DEFAULT 'INR' NOT NULL,
	"notes" text
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_employees_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uploads" ADD CONSTRAINT "uploads_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_upload_id_uploads_id_fk" FOREIGN KEY ("upload_id") REFERENCES "public"."uploads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_created_by_employees_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_workflow_idx" ON "audit_events" USING btree ("workflow_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uploads_object_key_unique" ON "uploads" USING btree ("object_key");--> statement-breakpoint
CREATE INDEX "uploads_created_by_idx" ON "uploads" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_steps_unique" ON "workflow_steps" USING btree ("workflow_id","employee_id");--> statement-breakpoint
CREATE INDEX "workflow_steps_workflow_position_idx" ON "workflow_steps" USING btree ("workflow_id","position");--> statement-breakpoint
CREATE INDEX "workflow_steps_employee_status_idx" ON "workflow_steps" USING btree ("employee_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "workflows_upload_unique" ON "workflows" USING btree ("upload_id");--> statement-breakpoint
CREATE INDEX "workflows_created_by_idx" ON "workflows" USING btree ("created_by","submitted_at");--> statement-breakpoint
CREATE INDEX "workflows_company_idx" ON "workflows" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "workflows_status_idx" ON "workflows" USING btree ("status");