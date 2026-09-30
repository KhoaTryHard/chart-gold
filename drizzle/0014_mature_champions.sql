CREATE TYPE "public"."ledger_side" AS ENUM('buy', 'sell');--> statement-breakpoint
CREATE TABLE "portfolio_ledgers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "portfolio_ledger_transactions" (
  "id" varchar(100) NOT NULL,
  "ledger_id" uuid NOT NULL,
  "sort_order" integer NOT NULL,
  "date" varchar(10) NOT NULL,
  "side" "ledger_side" NOT NULL,
  "company_id" varchar(50) NOT NULL,
  "product_id" varchar(100) NOT NULL,
  "quantity_luong" double precision NOT NULL,
  "unit_price_vnd" bigint NOT NULL,
  "fees_vnd" bigint DEFAULT 0 NOT NULL,
  "purchase_venue" varchar(160),
  "sale_venue" varchar(160),
  "invoice_status" varchar(40),
  "packaging_status" varchar(40),
  "serial" varchar(120),
  "note" varchar(500) DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "portfolio_ledger_mutations" (
  "operation_id" varchar(100) PRIMARY KEY NOT NULL,
  "ledger_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "portfolio_ledgers" ADD CONSTRAINT "portfolio_ledgers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_ledger_transactions" ADD CONSTRAINT "portfolio_ledger_transactions_ledger_id_portfolio_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."portfolio_ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_ledger_mutations" ADD CONSTRAINT "portfolio_ledger_mutations_ledger_id_portfolio_ledgers_id_fk" FOREIGN KEY ("ledger_id") REFERENCES "public"."portfolio_ledgers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_ledgers_user_unique" ON "portfolio_ledgers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "portfolio_ledger_transactions_pk" ON "portfolio_ledger_transactions" USING btree ("ledger_id","id");--> statement-breakpoint
CREATE INDEX "portfolio_ledger_transactions_order_idx" ON "portfolio_ledger_transactions" USING btree ("ledger_id","sort_order");--> statement-breakpoint
CREATE INDEX "portfolio_ledger_mutations_ledger_idx" ON "portfolio_ledger_mutations" USING btree ("ledger_id","created_at");
