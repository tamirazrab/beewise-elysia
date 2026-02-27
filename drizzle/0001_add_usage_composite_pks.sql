-- Add composite primary keys (idempotent: skip if already exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_usage_daily'::regclass AND contype = 'p') THEN
    ALTER TABLE "user_usage_daily" ADD PRIMARY KEY ("user_id", "usage_date");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_usage_monthly'::regclass AND contype = 'p') THEN
    ALTER TABLE "user_usage_monthly" ADD PRIMARY KEY ("user_id", "usage_year", "usage_month");
  END IF;
END $$;
--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_vocabulary_progress'::regclass AND contype = 'p') THEN
    ALTER TABLE "user_vocabulary_progress" ADD PRIMARY KEY ("user_id", "vocabulary_id");
  END IF;
END $$;