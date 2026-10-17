CREATE TABLE IF NOT EXISTS "media_storage_locations" (
  "pathname" text PRIMARY KEY,
  "provider" text NOT NULL,
  "object_key" text NOT NULL,
  "size" integer NOT NULL,
  "content_type" text NOT NULL,
  "sha256" varchar(64),
  "etag" text,
  "source_blob_url" text,
  "source_blob_etag" text,
  "verified_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "media_storage_provider_check" CHECK ("provider" IN ('blob', 'r2'))
);
