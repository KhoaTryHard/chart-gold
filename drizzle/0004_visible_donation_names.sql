UPDATE "donation_orders"
SET
  "display_name" = left(regexp_replace(trim("display_name"), '\\s+', ' ', 'g'), 120),
  "leaderboard_opt_in" = true,
  "updated_at" = now()
WHERE "is_anonymous" = false
  AND "display_name" IS NOT NULL
  AND length(trim("display_name")) > 0;
