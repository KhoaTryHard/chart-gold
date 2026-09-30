ALTER TABLE "articles" ADD COLUMN "published_category" varchar(40);
--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "public_modified_at" timestamp with time zone;
--> statement-breakpoint
CREATE TABLE "editorial_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "fingerprint" varchar(192) NOT NULL,
  "title" varchar(320) NOT NULL,
  "summary" text,
  "category" varchar(40),
  "status" varchar(32) DEFAULT 'candidate' NOT NULL,
  "relevance_score" integer DEFAULT 0 NOT NULL,
  "relevance_reason" text,
  "market_impact_summary" text,
  "detected_at" timestamp with time zone DEFAULT now() NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "selected_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "publication_category" varchar(40);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "source_event_id" uuid;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "seo_title" varchar(180);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "seo_description" varchar(360);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "cover_image_url" text;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "cover_image_alt" varchar(240);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "cover_image_storage_key" varchar(500);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "cover_image_disclosure" varchar(160);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "cover_image_provider" varchar(80);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "cover_image_model" varchar(120);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "cover_image_prompt" text;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "cover_image_generated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "approval_status" varchar(32);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "approved_by_user_id" uuid;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "approved_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD COLUMN "review_note" text;
--> statement-breakpoint
UPDATE "articles"
SET
  "published_category" = "category",
  "public_modified_at" = COALESCE("updated_at", "published_at", "created_at")
WHERE "status" = 'published';
--> statement-breakpoint
UPDATE "article_revisions" AS revision
SET "publication_category" = article."category"
FROM "articles" AS article
WHERE revision."article_id" = article."id";
--> statement-breakpoint
UPDATE "article_revisions"
SET "approval_status" = CASE
  WHEN "status" IN ('reviewed', 'published') THEN 'approved'
  ELSE 'pending'
END;
--> statement-breakpoint
ALTER TABLE "article_revisions" ALTER COLUMN "approval_status" SET DEFAULT 'pending';
--> statement-breakpoint
ALTER TABLE "article_revisions" ALTER COLUMN "approval_status" SET NOT NULL;
--> statement-breakpoint
CREATE TABLE "editorial_source_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_id" uuid,
  "event_id" uuid,
  "url" text NOT NULL,
  "normalized_url" text NOT NULL,
  "title" varchar(320),
  "domain" varchar(180) NOT NULL,
  "source_type" varchar(30) DEFAULT 'official' NOT NULL,
  "status" varchar(32) DEFAULT 'queued' NOT NULL,
  "published_at" timestamp with time zone,
  "fetched_at" timestamp with time zone,
  "content_excerpt" text,
  "content_hash" varchar(64),
  "raw_payload" jsonb,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_publication_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "local_date" date NOT NULL,
  "slot" varchar(16) NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "status" varchar(32) DEFAULT 'open' NOT NULL,
  "article_id" uuid,
  "revision_id" uuid,
  "scheduled_by_user_id" uuid,
  "scheduled_on" timestamp with time zone,
  "approved_by_user_id" uuid,
  "approved_at" timestamp with time zone,
  "published_by_user_id" uuid,
  "published_at" timestamp with time zone,
  "failure_count" integer DEFAULT 0 NOT NULL,
  "failure_message" text,
  "last_failed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "stage" varchar(40) DEFAULT 'generate' NOT NULL;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "revision_id" uuid;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "source_event_id" uuid;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "source_item_id" uuid;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "qstash_message_id" varchar(240);
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "max_attempts" integer DEFAULT 3 NOT NULL;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "retry_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "started_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "payload" jsonb;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "result" jsonb;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
CREATE TABLE "editorial_job_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "job_id" uuid NOT NULL,
  "attempt_number" integer NOT NULL,
  "stage" varchar(40) NOT NULL,
  "provider" varchar(80),
  "model" varchar(120),
  "status" varchar(32) DEFAULT 'running' NOT NULL,
  "retryable" boolean DEFAULT false NOT NULL,
  "http_status" integer,
  "retry_after_ms" integer,
  "upstream_request_id" varchar(240),
  "input_tokens" integer,
  "output_tokens" integer,
  "duration_ms" integer,
  "error_message" text,
  "metadata" jsonb,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "editorial_cost_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "idempotency_key" varchar(240) NOT NULL,
  "entry_type" varchar(40) DEFAULT 'generation' NOT NULL,
  "status" varchar(32) DEFAULT 'reserved' NOT NULL,
  "currency" varchar(3) DEFAULT 'VND' NOT NULL,
  "reserved_vnd" bigint DEFAULT 0 NOT NULL,
  "actual_vnd" bigint,
  "provider" varchar(80),
  "model" varchar(120),
  "job_id" uuid,
  "job_attempt_id" uuid,
  "article_id" uuid,
  "revision_id" uuid,
  "metadata" jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "settled_at" timestamp with time zone,
  "released_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_source_event_id_editorial_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."editorial_events"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_source_items" ADD CONSTRAINT "editorial_source_items_source_id_editorial_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."editorial_sources"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_source_items" ADD CONSTRAINT "editorial_source_items_event_id_editorial_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."editorial_events"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_publication_slots" ADD CONSTRAINT "editorial_publication_slots_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_publication_slots" ADD CONSTRAINT "editorial_publication_slots_revision_id_article_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_publication_slots" ADD CONSTRAINT "editorial_publication_slots_scheduled_by_user_id_users_id_fk" FOREIGN KEY ("scheduled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_publication_slots" ADD CONSTRAINT "editorial_publication_slots_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_publication_slots" ADD CONSTRAINT "editorial_publication_slots_published_by_user_id_users_id_fk" FOREIGN KEY ("published_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD CONSTRAINT "editorial_jobs_revision_id_article_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD CONSTRAINT "editorial_jobs_source_event_id_editorial_events_id_fk" FOREIGN KEY ("source_event_id") REFERENCES "public"."editorial_events"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD CONSTRAINT "editorial_jobs_source_item_id_editorial_source_items_id_fk" FOREIGN KEY ("source_item_id") REFERENCES "public"."editorial_source_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_job_attempts" ADD CONSTRAINT "editorial_job_attempts_job_id_editorial_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."editorial_jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_cost_ledger" ADD CONSTRAINT "editorial_cost_ledger_job_id_editorial_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."editorial_jobs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_cost_ledger" ADD CONSTRAINT "editorial_cost_ledger_job_attempt_id_editorial_job_attempts_id_fk" FOREIGN KEY ("job_attempt_id") REFERENCES "public"."editorial_job_attempts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_cost_ledger" ADD CONSTRAINT "editorial_cost_ledger_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_cost_ledger" ADD CONSTRAINT "editorial_cost_ledger_revision_id_article_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_events_fingerprint_unique" ON "editorial_events" USING btree ("fingerprint");
--> statement-breakpoint
CREATE INDEX "editorial_events_status_relevance_idx" ON "editorial_events" USING btree ("status", "relevance_score", "detected_at");
--> statement-breakpoint
CREATE INDEX "articles_published_category_published_idx" ON "articles" USING btree ("published_category", "published_at");
--> statement-breakpoint
CREATE INDEX "article_revisions_approval_status_idx" ON "article_revisions" USING btree ("approval_status", "created_at");
--> statement-breakpoint
CREATE INDEX "article_revisions_source_event_idx" ON "article_revisions" USING btree ("source_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_source_items_normalized_url_unique" ON "editorial_source_items" USING btree ("normalized_url");
--> statement-breakpoint
CREATE INDEX "editorial_source_items_event_fetched_idx" ON "editorial_source_items" USING btree ("event_id", "fetched_at");
--> statement-breakpoint
CREATE INDEX "editorial_source_items_status_fetched_idx" ON "editorial_source_items" USING btree ("status", "fetched_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_publication_slots_date_slot_unique" ON "editorial_publication_slots" USING btree ("local_date", "slot");
--> statement-breakpoint
CREATE INDEX "editorial_publication_slots_status_scheduled_idx" ON "editorial_publication_slots" USING btree ("status", "scheduled_at");
--> statement-breakpoint
CREATE INDEX "editorial_publication_slots_revision_idx" ON "editorial_publication_slots" USING btree ("revision_id");
--> statement-breakpoint
CREATE INDEX "editorial_jobs_status_retry_idx" ON "editorial_jobs" USING btree ("status", "retry_at");
--> statement-breakpoint
CREATE INDEX "editorial_jobs_event_stage_idx" ON "editorial_jobs" USING btree ("source_event_id", "stage");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_job_attempts_job_number_unique" ON "editorial_job_attempts" USING btree ("job_id", "attempt_number");
--> statement-breakpoint
CREATE INDEX "editorial_job_attempts_job_started_idx" ON "editorial_job_attempts" USING btree ("job_id", "started_at");
--> statement-breakpoint
CREATE INDEX "editorial_job_attempts_status_started_idx" ON "editorial_job_attempts" USING btree ("status", "started_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_cost_ledger_idempotency_unique" ON "editorial_cost_ledger" USING btree ("idempotency_key");
--> statement-breakpoint
CREATE INDEX "editorial_cost_ledger_status_created_idx" ON "editorial_cost_ledger" USING btree ("status", "created_at");
--> statement-breakpoint
CREATE INDEX "editorial_cost_ledger_job_idx" ON "editorial_cost_ledger" USING btree ("job_id");
