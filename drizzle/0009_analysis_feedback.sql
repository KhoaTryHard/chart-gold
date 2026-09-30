CREATE TABLE "analysis_runs" (
	"request_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"goal" varchar(20),
	"prompt_version" varchar(40) NOT NULL,
	"provider" varchar(40),
	"model" varchar(120),
	"outcome" varchar(30) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analysis_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"reason" varchar(40),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "analysis_feedback" ADD CONSTRAINT "analysis_feedback_request_id_analysis_runs_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."analysis_runs"("request_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "analysis_feedback" ADD CONSTRAINT "analysis_feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "analysis_runs_user_created_idx" ON "analysis_runs" USING btree ("user_id","created_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_feedback_user_request_unique" ON "analysis_feedback" USING btree ("user_id","request_id");
--> statement-breakpoint
CREATE INDEX "analysis_feedback_created_idx" ON "analysis_feedback" USING btree ("created_at");
