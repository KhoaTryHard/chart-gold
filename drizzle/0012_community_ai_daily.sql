alter type "public"."usage_bucket" add value if not exists 'community';
--> statement-breakpoint
create index if not exists "ai_usage_user_bucket_reserved_status_idx"
  on "ai_usage_events" using btree ("user_id", "bucket", "reserved_at", "status");
