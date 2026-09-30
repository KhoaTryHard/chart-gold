CREATE TABLE "article_translations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "source_revision_id" uuid NOT NULL,
  "locale" varchar(8) NOT NULL,
  "status" varchar(20) DEFAULT 'queued' NOT NULL,
  "title" varchar(180),
  "excerpt" varchar(360),
  "content_markdown" text,
  "seo_title" varchar(180),
  "seo_description" varchar(360),
  "cover_label" varchar(160),
  "cover_alt" varchar(240),
  "provider" varchar(80),
  "model" varchar(120),
  "input_tokens" integer,
  "output_tokens" integer,
  "error_message" text,
  "translated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "article_translations" ADD CONSTRAINT "article_translations_source_revision_id_article_revisions_id_fk" FOREIGN KEY ("source_revision_id") REFERENCES "public"."article_revisions"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "article_translations_revision_locale_unique" ON "article_translations" USING btree ("source_revision_id", "locale");
--> statement-breakpoint
CREATE INDEX "article_translations_status_updated_idx" ON "article_translations" USING btree ("status", "updated_at");
