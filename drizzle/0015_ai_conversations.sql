DO $$ BEGIN
 CREATE TYPE "public"."ai_conversation_turn_status" AS ENUM('pending', 'completed', 'failed', 'aborted');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_conversations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "title" varchar(180) NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "turn_count" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_conversation_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "conversation_id" uuid NOT NULL,
  "client_request_id" uuid,
  "sequence" integer NOT NULL,
  "question" text NOT NULL,
  "answer" text,
  "locale" varchar(8) DEFAULT 'vi' NOT NULL,
  "company_id" varchar(64) NOT NULL,
  "product_id" varchar(128) NOT NULL,
  "range" varchar(12) NOT NULL,
  "goal" varchar(24),
  "analysis_depth" varchar(24),
  "scenario_inputs" jsonb,
  "ledger_version" integer,
  "facts" jsonb,
  "decision" jsonb,
  "forecast" jsonb,
  "sources" jsonb,
  "citations" jsonb,
  "coverage" text,
  "warning" text,
  "status" "ai_conversation_turn_status" DEFAULT 'pending' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_conversations" ADD CONSTRAINT "ai_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_conversation_turns" ADD CONSTRAINT "ai_conversation_turns_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_user_updated_idx" ON "ai_conversations" USING btree ("user_id", "updated_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversations_expiry_idx" ON "ai_conversations" USING btree ("expires_at");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_conversation_turn_sequence_unique" ON "ai_conversation_turns" USING btree ("conversation_id", "sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_conversation_turn_request_unique" ON "ai_conversation_turns" USING btree ("conversation_id", "client_request_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_conversation_turn_conversation_idx" ON "ai_conversation_turns" USING btree ("conversation_id", "sequence");
