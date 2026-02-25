ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "linked_anonymous_id_hash" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anonymous_vocabulary_progress" (
	"anonymous_id_hash" text NOT NULL,
	"vocabulary_id" uuid NOT NULL,
	"mastery_level" integer DEFAULT 0 NOT NULL,
	"last_practiced_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anonymous_vocabulary_progress" ADD CONSTRAINT "anonymous_vocabulary_progress_vocabulary_id_vocabulary_item_id_fk" FOREIGN KEY ("vocabulary_id") REFERENCES "public"."vocabulary_item"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anonymous_vocabulary_progress_anonymous_id_hash_vocabulary_id_pk" ON "anonymous_vocabulary_progress" USING btree ("anonymous_id_hash","vocabulary_id");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anonymous_practice_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_id_hash" text NOT NULL,
	"type" "practice_type" NOT NULL,
	"language_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anonymous_practice_recording" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"s3_key" text NOT NULL,
	"duration_seconds" integer,
	"pronunciation_score" integer,
	"ai_feedback" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anonymous_practice_recording" ADD CONSTRAINT "anonymous_practice_recording_session_id_anonymous_practice_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."anonymous_practice_session"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anonymous_quiz_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_id_hash" text NOT NULL,
	"quiz_id" uuid NOT NULL,
	"score" numeric(5, 2) NOT NULL,
	"completed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "anonymous_quiz_attempt" ADD CONSTRAINT "anonymous_quiz_attempt_quiz_id_quiz_id_fk" FOREIGN KEY ("quiz_id") REFERENCES "public"."quiz"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "anonymous_favorite_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"anonymous_id_hash" text NOT NULL,
	"item_type" "favorite_type" NOT NULL,
	"item_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "anonymous_favorite_item_anonymous_id_hash_item_type_item_id_unique" ON "anonymous_favorite_item" USING btree ("anonymous_id_hash","item_type","item_id");
