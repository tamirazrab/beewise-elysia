CREATE TYPE "public"."plan_type" AS ENUM('free', 'trial', 'expired');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('active', 'closed');--> statement-breakpoint
CREATE TYPE "public"."difficulty_level" AS ENUM('beginner', 'intermediate', 'advanced');--> statement-breakpoint
CREATE TYPE "public"."favorite_type" AS ENUM('vocabulary', 'quiz');--> statement-breakpoint
CREATE TYPE "public"."practice_type" AS ENUM('speaking', 'listening');--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "role" text DEFAULT 'user';