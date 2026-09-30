ALTER TABLE "donation_orders" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "donation_orders" ADD COLUMN "leaderboard_opt_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "donation_orders" ADD CONSTRAINT "donation_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "donation_orders_user_status_idx" ON "donation_orders" USING btree ("user_id","status");
