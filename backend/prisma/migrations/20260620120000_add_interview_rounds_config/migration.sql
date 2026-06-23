-- Add interview round controls and auto-advance threshold to Job
ALTER TABLE "Job" ADD COLUMN "maxInterviewRounds"   INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Job" ADD COLUMN "autoAdvanceThreshold" INTEGER NOT NULL DEFAULT 75;
