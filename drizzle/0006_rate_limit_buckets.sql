CREATE TABLE IF NOT EXISTS "request_rate_limit_buckets" (
	"key" varchar(240) PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone DEFAULT now() NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "request_rate_limit_expires_idx" ON "request_rate_limit_buckets" USING btree ("expires_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "market_history_leases" (
	"key" varchar(200) PRIMARY KEY NOT NULL,
	"owner" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"heartbeat_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TYPE "market_history_sync_run_status" ADD VALUE IF NOT EXISTS 'partial';
--> statement-breakpoint
ALTER TYPE "market_history_sync_run_status" ADD VALUE IF NOT EXISTS 'skipped_locked';
