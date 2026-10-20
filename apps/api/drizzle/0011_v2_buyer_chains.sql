CREATE TABLE "buyer_slot_gates" (
	"buyer_id" uuid NOT NULL,
	"slot" "slot" NOT NULL,
	"gate" "gate" NOT NULL,
	CONSTRAINT "buyer_slot_gates_buyer_id_slot_pk" PRIMARY KEY("buyer_id","slot")
);
--> statement-breakpoint
CREATE TABLE "buyer_slot_people" (
	"buyer_id" uuid NOT NULL,
	"slot" "slot" NOT NULL,
	"employee_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	CONSTRAINT "buyer_slot_people_buyer_id_slot_employee_id_pk" PRIMARY KEY("buyer_id","slot","employee_id")
);
--> statement-breakpoint
DROP INDEX "orders_company_idx";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "company_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "buyers" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "ref" text;--> statement-breakpoint
ALTER TABLE "buyer_slot_gates" ADD CONSTRAINT "buyer_slot_gates_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_slot_people" ADD CONSTRAINT "buyer_slot_people_buyer_id_buyers_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."buyers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_slot_people" ADD CONSTRAINT "buyer_slot_people_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "buyer_slot_people_employee_idx" ON "buyer_slot_people" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "buyers_code_unique" ON "buyers" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_ref_lower_unique" ON "orders" USING btree (lower("ref"));--> statement-breakpoint
-- D27: the buyer holds the default chain. Each buyer takes the chain of the company on its
-- latest order (best effort; orders keep their own copy either way).
INSERT INTO "buyer_slot_people" ("buyer_id", "slot", "employee_id", "ordinal")
SELECT b."id", p."slot", p."employee_id", p."ordinal"
  FROM "buyers" b
  CROSS JOIN LATERAL (
    SELECT o."company_id" FROM "orders" o WHERE o."buyer_id" = b."id"
     ORDER BY o."created_at" DESC LIMIT 1) last
  JOIN "company_slot_people" p ON p."company_id" = last."company_id";--> statement-breakpoint
INSERT INTO "buyer_slot_gates" ("buyer_id", "slot", "gate")
SELECT b."id", g."slot", g."gate"
  FROM "buyers" b
  CROSS JOIN LATERAL (
    SELECT o."company_id" FROM "orders" o WHERE o."buyer_id" = b."id"
     ORDER BY o."created_at" DESC LIMIT 1) last
  JOIN "company_slot_gates" g ON g."company_id" = last."company_id";--> statement-breakpoint
UPDATE "orders" SET "ref" = 'ORD-' || lpad("number"::text, 4, '0');
