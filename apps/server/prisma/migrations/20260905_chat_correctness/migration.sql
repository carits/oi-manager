ALTER TABLE "DirectConversation" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
UPDATE "DirectConversation" SET "lastActivityAt" = COALESCE("lastMessageAt", "createdAt");
ALTER TABLE "DirectConversation" ALTER COLUMN "lastActivityAt" SET NOT NULL;
ALTER TABLE "DirectConversation" ALTER COLUMN "lastActivityAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "DirectConversation_lastActivityAt_id_idx"
ON "DirectConversation"("lastActivityAt", "id");

ALTER TABLE "ChatReport"
  ADD COLUMN "evidenceReleasedAt" TIMESTAMP(3),
  ALTER COLUMN "messageId" DROP NOT NULL;

ALTER TABLE "ChatReport" DROP CONSTRAINT "ChatReport_messageId_fkey";
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "DirectMessage"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ChatMaintenanceCursor" (
  "name" TEXT NOT NULL,
  "cursor" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatMaintenanceCursor_pkey" PRIMARY KEY ("name")
);
