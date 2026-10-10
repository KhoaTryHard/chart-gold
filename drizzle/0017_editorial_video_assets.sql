CREATE TABLE "editorial_video_assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" varchar(80) NOT NULL,
  "root_id" varchar(80) NOT NULL,
  "draft_id" varchar(80) NOT NULL,
  "external_revision" integer NOT NULL,
  "descriptor" jsonb NOT NULL,
  "descriptor_digest" varchar(64) NOT NULL,
  "pathname" text NOT NULL,
  "blob_url" text,
  "blob_etag" text,
  "status" varchar(24) DEFAULT 'uploading' NOT NULL,
  "validated_at" timestamptz,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  "updated_at" timestamptz DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_video_client_draft_unique" ON "editorial_video_assets"("client_id", "draft_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "editorial_video_pathname_unique" ON "editorial_video_assets"("pathname");
--> statement-breakpoint
CREATE INDEX "editorial_video_status_idx" ON "editorial_video_assets"("status", "created_at");
