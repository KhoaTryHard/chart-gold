CREATE TABLE `gold_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`observed_at` text NOT NULL,
	`observed_date` text NOT NULL,
	`buy` real NOT NULL,
	`sell` real NOT NULL,
	`provider` text NOT NULL,
	`source_url` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gold_snapshots_observed_at_unique` ON `gold_snapshots` (`observed_at`);--> statement-breakpoint
CREATE INDEX `idx_gold_snapshots_date` ON `gold_snapshots` (`observed_date`);--> statement-breakpoint
PRAGMA optimize;
