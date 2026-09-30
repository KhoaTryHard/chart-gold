CREATE TYPE "public"."market_history_point_status" AS ENUM('ok', 'missing', 'error');--> statement-breakpoint
CREATE TYPE "public"."market_history_sync_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "market_history_points" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" varchar(120) NOT NULL,
	"company_id" varchar(64) NOT NULL,
	"product_id" varchar(128) NOT NULL,
	"region" varchar(128) DEFAULT '' NOT NULL,
	"date" date NOT NULL,
	"buy_vnd_per_luong" bigint,
	"sell_vnd_per_luong" bigint,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source_url" text,
	"status" "market_history_point_status" NOT NULL,
	"error_message" text,
	"raw_payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "market_history_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sync_key" varchar(200) NOT NULL,
	"provider" varchar(120) NOT NULL,
	"company_id" varchar(64) NOT NULL,
	"product_id" varchar(128) NOT NULL,
	"requested_start" date NOT NULL,
	"requested_end" date NOT NULL,
	"status" "market_history_sync_run_status" NOT NULL,
	"expected_days" integer DEFAULT 0 NOT NULL,
	"ok_days" integer DEFAULT 0 NOT NULL,
	"missing_days" integer DEFAULT 0 NOT NULL,
	"error_days" integer DEFAULT 0 NOT NULL,
	"message" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "market_history_points_identity_unique" ON "market_history_points" USING btree ("provider","company_id","product_id","region","date");--> statement-breakpoint
CREATE INDEX "market_history_points_lookup_idx" ON "market_history_points" USING btree ("company_id","product_id","date");--> statement-breakpoint
CREATE INDEX "market_history_points_status_date_idx" ON "market_history_points" USING btree ("status","date");--> statement-breakpoint
CREATE INDEX "market_history_sync_runs_lookup_idx" ON "market_history_sync_runs" USING btree ("sync_key","started_at");--> statement-breakpoint
CREATE INDEX "market_history_sync_runs_status_idx" ON "market_history_sync_runs" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "market_history_sync_runs_one_active_per_key" ON "market_history_sync_runs" USING btree ("sync_key") WHERE "status" = 'running';
