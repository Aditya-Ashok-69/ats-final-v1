-- Migration: add structured resume fields to Candidate
-- Generated to match schema.prisma changes. Run: npx prisma migrate dev

ALTER TABLE "Candidate" ADD COLUMN "skills"                   TEXT DEFAULT '[]';
ALTER TABLE "Candidate" ADD COLUMN "workExperience"           TEXT DEFAULT '[]';
ALTER TABLE "Candidate" ADD COLUMN "internships"              TEXT DEFAULT '[]';
ALTER TABLE "Candidate" ADD COLUMN "education"                TEXT DEFAULT '[]';
ALTER TABLE "Candidate" ADD COLUMN "certifications"           TEXT DEFAULT '[]';
ALTER TABLE "Candidate" ADD COLUMN "totalExperienceYears"     REAL;
ALTER TABLE "Candidate" ADD COLUMN "technicalExperienceYears" REAL;
ALTER TABLE "Candidate" ADD COLUMN "parseEngine"              TEXT;
ALTER TABLE "Candidate" ADD COLUMN "parsedAt"                 DATETIME;
