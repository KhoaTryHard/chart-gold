CREATE TABLE `gold_product_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` text NOT NULL,
	`observed_at` text NOT NULL,
	`observed_date` text NOT NULL,
	`buy` real NOT NULL,
	`sell` real NOT NULL,
	`provider` text NOT NULL,
	`source_url` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_gold_product_snapshots_series_observed` ON `gold_product_snapshots` (`series_id`,`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_gold_product_snapshots_series_date` ON `gold_product_snapshots` (`series_id`,`observed_date`);--> statement-breakpoint
PRAGMA optimize;
