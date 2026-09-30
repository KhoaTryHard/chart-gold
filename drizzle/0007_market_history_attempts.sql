CREATE TABLE "market_history_fetch_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(120) NOT NULL,
	"company_id" varchar(64) NOT NULL,
	"product_id" varchar(128) NOT NULL,
	"region" varchar(128) DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"status" "market_history_point_status" NOT NULL,
	"source_url" text,
	"error_message" text,
	"raw_payload" jsonb,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "market_history_attempt_lookup_idx" ON "market_history_fetch_attempts" USING btree ("provider","company_id","product_id","date","retrieved_at");
