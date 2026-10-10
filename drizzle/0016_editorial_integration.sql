CREATE TABLE "editorial_integration_packages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" varchar(80) NOT NULL, "root_id" varchar(80) NOT NULL,
  "draft_id" varchar(80) NOT NULL, "external_revision" integer NOT NULL,
  "input_digest" varchar(64) NOT NULL, "review_digest" varchar(64) NOT NULL,
  "review_package" text NOT NULL, "website_version" varchar(64) NOT NULL,
  "article_id" uuid NOT NULL REFERENCES "articles"("id"),
  "revision_id" uuid NOT NULL REFERENCES "article_revisions"("id"),
  "image_sha256" varchar(64) NOT NULL, "state" varchar(32) DEFAULT 'prepared' NOT NULL,
  "approval_provenance" jsonb, "receipt" jsonb, "published_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL, "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_integration_client_draft_unique" ON "editorial_integration_packages"("client_id","draft_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_integration_root_revision_unique" ON "editorial_integration_packages"("client_id","root_id","external_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_integration_revision_unique" ON "editorial_integration_packages"("revision_id");
--> statement-breakpoint
CREATE INDEX "editorial_integration_root_idx" ON "editorial_integration_packages"("client_id","root_id");
