CREATE TABLE "UserNotification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "href" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserNotification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserNotification_userId_scope_sourceType_sourceId_key"
  ON "UserNotification"("userId", "scope", "sourceType", "sourceId");
CREATE INDEX "UserNotification_userId_scope_readAt_createdAt_idx"
  ON "UserNotification"("userId", "scope", "readAt", "createdAt");
CREATE INDEX "UserNotification_userId_scope_createdAt_idx"
  ON "UserNotification"("userId", "scope", "createdAt");

ALTER TABLE "UserNotification"
  ADD CONSTRAINT "UserNotification_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
