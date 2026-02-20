-- Enums already created in 0000_absent_maddog.sql; only add user.role here
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user';