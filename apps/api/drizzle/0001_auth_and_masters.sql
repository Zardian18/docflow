CREATE TYPE "public"."password_token_purpose" AS ENUM('SET', 'RESET');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_default_approvers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "company_default_approvers_position_positive" CHECK ("company_default_approvers"."position" > 0)
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_code" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role_id" uuid NOT NULL,
	"password_hash" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"is_cfo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"purpose" "password_token_purpose" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
ALTER TABLE "roles" DROP CONSTRAINT "roles_name_unique";--> statement-breakpoint
ALTER TABLE "company_default_approvers" ADD CONSTRAINT "company_default_approvers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_default_approvers" ADD CONSTRAINT "company_default_approvers_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_tokens" ADD CONSTRAINT "password_tokens_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_lower_unique" ON "companies" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "companies_code_unique" ON "companies" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "company_default_approvers_unique" ON "company_default_approvers" USING btree ("company_id","employee_id");--> statement-breakpoint
CREATE INDEX "company_default_approvers_employee_idx" ON "company_default_approvers" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_email_unique" ON "employees" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_code_unique" ON "employees" USING btree ("employee_code");--> statement-breakpoint
CREATE UNIQUE INDEX "employees_one_active_cfo" ON "employees" USING btree ("is_cfo") WHERE "employees"."is_cfo" and "employees"."is_active";--> statement-breakpoint
CREATE INDEX "employees_role_idx" ON "employees" USING btree ("role_id");--> statement-breakpoint
CREATE INDEX "employees_name_lower_idx" ON "employees" USING btree (lower("name") text_pattern_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "password_tokens_hash_unique" ON "password_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "password_tokens_employee_idx" ON "password_tokens" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_employee_idx" ON "sessions" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_name_lower_unique" ON "roles" USING btree (lower("name"));