ALTER TABLE "notices" ADD COLUMN "audience_id" uuid;--> statement-breakpoint
ALTER TABLE "notices" ADD CONSTRAINT "notices_audience_id_audiences_id_fk" FOREIGN KEY ("audience_id") REFERENCES "public"."audiences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "component_changes_order_idx" ON "component_changes" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "holder_intervals_order_idx" ON "holder_intervals" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "order_components_order_idx" ON "order_components" USING btree ("order_id","sr_no");