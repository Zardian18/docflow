-- DocFlow v2 (D24): the v1 approval engine and role model are retired.
-- Admins keep their access: they are remembered here and become ADMIN capabilities in 0010.
CREATE TABLE "v1_admins" AS SELECT DISTINCT er."employee_id" FROM "employee_roles" er
  JOIN "roles" r ON r."id" = er."role_id" WHERE r."permission" = 'ADMIN';--> statement-breakpoint
DROP TABLE "audit_events" CASCADE;--> statement-breakpoint
DROP TABLE "company_default_approvers" CASCADE;--> statement-breakpoint
DROP TABLE "employee_roles" CASCADE;--> statement-breakpoint
DROP TABLE "notification_outbox" CASCADE;--> statement-breakpoint
DROP TABLE "role_exclusions" CASCADE;--> statement-breakpoint
DROP TABLE "roles" CASCADE;--> statement-breakpoint
DROP TABLE "workflow_steps" CASCADE;--> statement-breakpoint
DROP TABLE "workflows" CASCADE;--> statement-breakpoint
DROP INDEX "employees_one_active_cfo";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "is_cfo";--> statement-breakpoint
DROP TYPE "public"."outbox_status";--> statement-breakpoint
DROP TYPE "public"."permission";--> statement-breakpoint
DROP TYPE "public"."step_status";--> statement-breakpoint
DROP TYPE "public"."workflow_status";--> statement-breakpoint
DROP FUNCTION IF EXISTS audit_events_append_only();
