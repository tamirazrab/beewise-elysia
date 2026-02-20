-- Enums already created in 0000_absent_maddog.sql; only add user.role here (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'user' AND column_name = 'role'
  ) THEN
    ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user';
  END IF;
END $$;