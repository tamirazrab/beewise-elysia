CREATE TABLE "trial_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id_hash" text NOT NULL UNIQUE,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"first_seen_ip_hash" text,
	"chat_sessions_used" integer DEFAULT 0 NOT NULL,
	"chat_messages_used" integer DEFAULT 0 NOT NULL,
	"voice_sessions_used" integer DEFAULT 0 NOT NULL,
	"voice_seconds_used" integer DEFAULT 0 NOT NULL,
	"exhausted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_conversation_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id_hash" text NOT NULL,
	"language_code" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_conversation_message" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"token_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trial_voice_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trial_id_hash" text NOT NULL,
	"language_code" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"seconds_used" integer DEFAULT 0 NOT NULL,
	"cost_estimate_usd" numeric(12, 6) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trial_conversation_message" ADD CONSTRAINT "trial_conversation_message_session_id_trial_conversation_session_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."trial_conversation_session"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trial_identity_trial_id_hash_idx" ON "trial_identity" USING btree ("trial_id_hash");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trial_identity_first_seen_ip_hash_created_at_idx" ON "trial_identity" USING btree ("first_seen_ip_hash","created_at");
