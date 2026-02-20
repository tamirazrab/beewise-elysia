-- Add composite primary keys required for ON CONFLICT upserts
ALTER TABLE "user_usage_daily" ADD PRIMARY KEY ("user_id", "usage_date");
--> statement-breakpoint
ALTER TABLE "user_usage_monthly" ADD PRIMARY KEY ("user_id", "usage_year", "usage_month");
