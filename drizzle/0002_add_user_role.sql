-- Add role column for admin guard (user | admin)
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "role" text DEFAULT 'user';
