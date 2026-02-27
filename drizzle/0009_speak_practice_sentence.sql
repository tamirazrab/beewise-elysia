-- Speak practice sentences table (reuses difficulty_level enum from vocabulary)
CREATE TABLE IF NOT EXISTS "speak_practice_sentence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sentence" text NOT NULL,
	"language_code" text NOT NULL,
	"level" "difficulty_level" NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
