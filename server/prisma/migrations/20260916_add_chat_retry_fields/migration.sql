ALTER TABLE "chat_messages"
  ADD COLUMN "referencedMessageId" TEXT,
  ADD COLUMN "retryStatus" TEXT;