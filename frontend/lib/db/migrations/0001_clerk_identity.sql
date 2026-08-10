ALTER TABLE "User" ALTER COLUMN "email" TYPE varchar(320);
--> statement-breakpoint
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "clerkUserId" varchar(64);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "User" ADD CONSTRAINT "User_clerkUserId_unique" UNIQUE("clerkUserId");
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
