-- D23: a person can hold several roles (one, or one Creator-type plus one Approver-type),
-- and roles can exclude each other. Everyone keeps the role they had.
CREATE UNIQUE INDEX "roles_id_permission_unique" ON "roles" USING btree ("id","permission");--> statement-breakpoint
CREATE TABLE "employee_roles" (
	"employee_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"permission" "permission" NOT NULL,
	CONSTRAINT "employee_roles_employee_id_role_id_pk" PRIMARY KEY("employee_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "role_exclusions" (
	"role_id" uuid NOT NULL,
	"excluded_role_id" uuid NOT NULL,
	CONSTRAINT "role_exclusions_role_id_excluded_role_id_pk" PRIMARY KEY("role_id","excluded_role_id"),
	CONSTRAINT "role_exclusions_not_self" CHECK ("role_exclusions"."role_id" <> "role_exclusions"."excluded_role_id")
);
--> statement-breakpoint
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_roles" ADD CONSTRAINT "employee_roles_role_fk" FOREIGN KEY ("role_id","permission") REFERENCES "public"."roles"("id","permission") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_exclusions" ADD CONSTRAINT "role_exclusions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_exclusions" ADD CONSTRAINT "role_exclusions_excluded_role_id_roles_id_fk" FOREIGN KEY ("excluded_role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "employee_roles_one_per_permission" ON "employee_roles" USING btree ("employee_id","permission");--> statement-breakpoint
CREATE INDEX "employee_roles_role_idx" ON "employee_roles" USING btree ("role_id");--> statement-breakpoint
INSERT INTO "employee_roles" ("employee_id", "role_id", "permission")
SELECT e."id", e."role_id", r."permission" FROM "employees" e JOIN "roles" r ON r."id" = e."role_id";--> statement-breakpoint
ALTER TABLE "employees" DROP CONSTRAINT "employees_role_id_roles_id_fk";--> statement-breakpoint
DROP INDEX "employees_role_idx";--> statement-breakpoint
ALTER TABLE "employees" DROP COLUMN "role_id";
