CREATE TYPE "public"."ai_capability" AS ENUM('standard', 'research', 'portfolio', 'deep');--> statement-breakpoint
CREATE TYPE "public"."payment_order_status" AS ENUM('pending', 'paid', 'needs_review', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."plan_code" AS ENUM('trial', 'basic', 'plus', 'pro');--> statement-breakpoint
CREATE TYPE "public"."sepay_processing_status" AS ENUM('accepted', 'needs_review', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'scheduled', 'expired', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."usage_bucket" AS ENUM('trial', 'subscription');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('reserved', 'completed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "ai_usage_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"bucket" "usage_bucket" NOT NULL,
	"period_id" uuid,
	"capability" "ai_capability" NOT NULL,
	"status" "usage_status" DEFAULT 'reserved' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"provider" varchar(40),
	"model" varchar(120),
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"duration_ms" integer
);
--> statement-breakpoint
CREATE TABLE "billing_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"actor_user_id" uuid,
	"event_type" varchar(60) NOT NULL,
	"entity_type" varchar(60) NOT NULL,
	"entity_id" varchar(100),
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" "plan_code" NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"order_code" varchar(32) NOT NULL,
	"status" "payment_order_status" DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	"sepay_transaction_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sepay_transactions" (
	"sepay_id" bigint PRIMARY KEY NOT NULL,
	"payment_order_id" uuid,
	"gateway" varchar(100) NOT NULL,
	"account_number" varchar(100) NOT NULL,
	"transfer_type" varchar(20) NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"order_code" varchar(32),
	"reference_code" varchar(255),
	"transaction_date" timestamp with time zone,
	"raw_body_hash" varchar(64) NOT NULL,
	"status" "sepay_processing_status" NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan" "plan_code" NOT NULL,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"quota_limit" integer NOT NULL,
	"amount_vnd" bigint NOT NULL,
	"payment_order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"google_subject" varchar(255) NOT NULL,
	"email" varchar(320) NOT NULL,
	"name" varchar(200),
	"image" text,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_events" ADD CONSTRAINT "ai_usage_events_period_id_subscription_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."subscription_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_audit_events" ADD CONSTRAINT "billing_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_orders" ADD CONSTRAINT "payment_orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sepay_transactions" ADD CONSTRAINT "sepay_transactions_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_periods" ADD CONSTRAINT "subscription_periods_payment_order_id_payment_orders_id_fk" FOREIGN KEY ("payment_order_id") REFERENCES "public"."payment_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_usage_user_request_unique" ON "ai_usage_events" USING btree ("user_id","client_request_id");--> statement-breakpoint
CREATE INDEX "ai_usage_user_bucket_status_idx" ON "ai_usage_events" USING btree ("user_id","bucket","status");--> statement-breakpoint
CREATE INDEX "ai_usage_period_status_idx" ON "ai_usage_events" USING btree ("period_id","status");--> statement-breakpoint
CREATE INDEX "billing_audit_user_created_idx" ON "billing_audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "billing_audit_entity_idx" ON "billing_audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_order_code_unique" ON "payment_orders" USING btree ("order_code");--> statement-breakpoint
CREATE UNIQUE INDEX "payment_orders_sepay_transaction_unique" ON "payment_orders" USING btree ("sepay_transaction_id");--> statement-breakpoint
CREATE INDEX "payment_orders_user_status_idx" ON "payment_orders" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "sepay_transactions_order_code_idx" ON "sepay_transactions" USING btree ("order_code");--> statement-breakpoint
CREATE INDEX "sepay_transactions_status_idx" ON "sepay_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscription_periods_user_dates_idx" ON "subscription_periods" USING btree ("user_id","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "subscription_periods_status_idx" ON "subscription_periods" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_google_subject_unique" ON "users" USING btree ("google_subject");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email");