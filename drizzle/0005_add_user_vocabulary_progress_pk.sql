-- Add composite primary key for user_vocabulary_progress (required for ON CONFLICT in seed)
-- Idempotent: safe if 0001 already added it or this runs again
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_vocabulary_progress'::regclass AND contype = 'p') THEN
    ALTER TABLE "user_vocabulary_progress" ADD PRIMARY KEY ("user_id", "vocabulary_id");
  END IF;
END $$;
