CREATE TABLE "articles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" varchar(180) NOT NULL,
  "category" varchar(40) NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "author_name" varchar(160) DEFAULT 'Kim Tuyến' NOT NULL,
  "author_url" text,
  "pinned_until" timestamp with time zone,
  "published_revision_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "article_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "article_id" uuid NOT NULL,
  "title" varchar(180) NOT NULL,
  "excerpt" varchar(360) NOT NULL,
  "content_markdown" text NOT NULL,
  "cover_label" varchar(160),
  "cover_alt" varchar(240),
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" varchar(20) DEFAULT 'draft' NOT NULL,
  "created_by_user_id" uuid,
  "reviewed_by_user_id" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "title" varchar(180) NOT NULL,
  "url" text NOT NULL,
  "domain" varchar(180) NOT NULL,
  "source_type" varchar(30) DEFAULT 'official' NOT NULL,
  "allowed" boolean DEFAULT true NOT NULL,
  "last_checked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_jobs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "topic" varchar(240) NOT NULL,
  "dedupe_key" varchar(240) NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "provider" varchar(40),
  "model" varchar(120),
  "input_tokens" integer,
  "output_tokens" integer,
  "cost_vnd" bigint DEFAULT 0 NOT NULL,
  "article_id" uuid,
  "error_message" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "article_revisions" ADD CONSTRAINT "article_revisions_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "editorial_jobs" ADD CONSTRAINT "editorial_jobs_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "articles_slug_unique" ON "articles" USING btree ("slug");
--> statement-breakpoint
CREATE INDEX "articles_status_published_idx" ON "articles" USING btree ("status", "published_at");
--> statement-breakpoint
CREATE INDEX "articles_category_published_idx" ON "articles" USING btree ("category", "published_at");
--> statement-breakpoint
CREATE INDEX "article_revisions_article_created_idx" ON "article_revisions" USING btree ("article_id", "created_at");
--> statement-breakpoint
CREATE INDEX "article_revisions_status_idx" ON "article_revisions" USING btree ("status");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_sources_url_unique" ON "editorial_sources" USING btree ("url");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_jobs_dedupe_unique" ON "editorial_jobs" USING btree ("dedupe_key");
--> statement-breakpoint
CREATE INDEX "editorial_jobs_status_created_idx" ON "editorial_jobs" USING btree ("status", "created_at");
