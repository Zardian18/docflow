-- D27: buyer and company are the same thing; the Company master goes
ALTER TABLE "orders" DROP CONSTRAINT "orders_company_id_companies_id_fk";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "company_id";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "ref" SET NOT NULL;--> statement-breakpoint
DROP TABLE "company_slot_gates";--> statement-breakpoint
DROP TABLE "company_slot_people";--> statement-breakpoint
DROP TABLE "companies";
