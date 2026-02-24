CREATE TABLE "paid_voice_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp,
	"seconds_used" integer DEFAULT 0 NOT NULL,
	"cost_estimate_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"language_code" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "paid_voice_session" ADD CONSTRAINT "paid_voice_session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;
