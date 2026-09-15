-- AlterTable
ALTER TABLE "proposals" ADD COLUMN "draftPayload" jsonb;
ALTER TABLE "proposals" ADD COLUMN "changePayload" jsonb;
ALTER TABLE "proposals" ADD COLUMN "before" jsonb;
ALTER TABLE "proposals" ADD COLUMN "after" jsonb;
