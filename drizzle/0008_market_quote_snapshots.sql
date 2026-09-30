CREATE TABLE "market_quote_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purpose" varchar(32) DEFAULT 'live' NOT NULL,
	"source" varchar(120) NOT NULL,
	"company_id" varchar(64) NOT NULL,
	"product_id" varchar(128) NOT NULL,
	"region" varchar(128) DEFAULT '' NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_success_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "market_quote_snapshot_identity_unique" ON "market_quote_snapshots" USING btree ("purpose","source","company_id","product_id","region");
--> statement-breakpoint
CREATE INDEX "market_quote_snapshot_lookup_idx" ON "market_quote_snapshots" USING btree ("company_id","product_id","purpose","fetched_at");
