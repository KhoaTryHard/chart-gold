CREATE TYPE "public"."donation_order_status" AS ENUM('pending', 'paid', 'needs_review', 'expired', 'cancelled');--> statement-breakpoint
CREATE TABLE "donation_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"order_code" varchar(32) NOT NULL,
	"display_name" varchar(120),
	"is_anonymous" boolean DEFAULT true NOT NULL,
	"status" "donation_order_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"sepay_transaction_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD COLUMN "cost_vnd" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sepay_transactions" ADD COLUMN "donation_order_id" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "donation_orders_order_code_unique" ON "donation_orders" USING btree ("order_code");--> statement-breakpoint
CREATE UNIQUE INDEX "donation_orders_sepay_transaction_unique" ON "donation_orders" USING btree ("sepay_transaction_id");--> statement-breakpoint
CREATE INDEX "donation_orders_status_created_idx" ON "donation_orders" USING btree ("status","created_at");--> statement-breakpoint
ALTER TABLE "sepay_transactions" ADD CONSTRAINT "sepay_transactions_donation_order_id_donation_orders_id_fk" FOREIGN KEY ("donation_order_id") REFERENCES "public"."donation_orders"("id") ON DELETE no action ON UPDATE no action;