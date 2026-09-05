CREATE TABLE "ChatPrivacySetting" (
  "userId" TEXT NOT NULL,
  "allowExactUsernameDiscovery" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatPrivacySetting_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "FriendRequest" (
  "id" TEXT NOT NULL, "requesterId" TEXT NOT NULL, "addresseeId" TEXT NOT NULL,
  "message" VARCHAR(500), "status" TEXT NOT NULL DEFAULT 'pending',
  "respondedAt" TIMESTAMP(3), "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FriendRequest_distinct_users" CHECK ("requesterId" <> "addresseeId")
);
CREATE UNIQUE INDEX "FriendRequest_pending_pair_key" ON "FriendRequest" (LEAST("requesterId", "addresseeId"), GREATEST("requesterId", "addresseeId")) WHERE "status" = 'pending';
CREATE INDEX "FriendRequest_requesterId_status_createdAt_idx" ON "FriendRequest"("requesterId", "status", "createdAt");
CREATE INDEX "FriendRequest_addresseeId_status_createdAt_idx" ON "FriendRequest"("addresseeId", "status", "createdAt");
CREATE INDEX "FriendRequest_expiresAt_status_idx" ON "FriendRequest"("expiresAt", "status");

CREATE TABLE "Friendship" (
  "id" TEXT NOT NULL, "userLowId" TEXT NOT NULL, "userHighId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active', "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt" TIMESTAMP(3), "removedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id"), CONSTRAINT "Friendship_ordered_users" CHECK ("userLowId" < "userHighId")
);
CREATE UNIQUE INDEX "Friendship_userLowId_userHighId_key" ON "Friendship"("userLowId", "userHighId");
CREATE INDEX "Friendship_userLowId_status_idx" ON "Friendship"("userLowId", "status");
CREATE INDEX "Friendship_userHighId_status_idx" ON "Friendship"("userHighId", "status");

CREATE TABLE "UserBlock" (
  "id" TEXT NOT NULL, "blockerId" TEXT NOT NULL, "blockedId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("id"), CONSTRAINT "UserBlock_distinct_users" CHECK ("blockerId" <> "blockedId")
);
CREATE UNIQUE INDEX "UserBlock_blockerId_blockedId_key" ON "UserBlock"("blockerId", "blockedId");
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

CREATE TABLE "DirectConversation" (
  "id" TEXT NOT NULL, "userLowId" TEXT NOT NULL, "userHighId" TEXT NOT NULL,
  "lastMessageSeq" INTEGER NOT NULL DEFAULT 0, "lastMessagePreview" TEXT, "lastMessageAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectConversation_pkey" PRIMARY KEY ("id"), CONSTRAINT "DirectConversation_ordered_users" CHECK ("userLowId" < "userHighId")
);
CREATE UNIQUE INDEX "DirectConversation_userLowId_userHighId_key" ON "DirectConversation"("userLowId", "userHighId");
CREATE INDEX "DirectConversation_lastMessageAt_idx" ON "DirectConversation"("lastMessageAt");

CREATE TABLE "DirectConversationMember" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "lastReadSeq" INTEGER NOT NULL DEFAULT 0, "unreadCount" INTEGER NOT NULL DEFAULT 0,
  "archivedAt" TIMESTAMP(3), "mutedUntil" TIMESTAMP(3), "clearedThroughSeq" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectConversationMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DirectConversationMember_conversationId_userId_key" ON "DirectConversationMember"("conversationId", "userId");
CREATE INDEX "DirectConversationMember_userId_archivedAt_updatedAt_idx" ON "DirectConversationMember"("userId", "archivedAt", "updatedAt");

CREATE TABLE "DirectMessage" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "senderUserId" TEXT NOT NULL,
  "clientMessageId" TEXT NOT NULL, "seq" INTEGER NOT NULL, "content" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DirectMessage_conversationId_seq_key" ON "DirectMessage"("conversationId", "seq");
CREATE UNIQUE INDEX "DirectMessage_conversationId_senderUserId_clientMessageId_key" ON "DirectMessage"("conversationId", "senderUserId", "clientMessageId");
CREATE INDEX "DirectMessage_senderUserId_createdAt_idx" ON "DirectMessage"("senderUserId", "createdAt");

CREATE TABLE "ChatUserEvent" (
  "id" BIGSERIAL NOT NULL, "userId" TEXT NOT NULL, "eventType" TEXT NOT NULL,
  "conversationId" TEXT, "messageId" TEXT, "payload" JSONB, "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatUserEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ChatUserEvent_userId_id_idx" ON "ChatUserEvent"("userId", "id");
CREATE INDEX "ChatUserEvent_expiresAt_idx" ON "ChatUserEvent"("expiresAt");

CREATE TABLE "ChatReport" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "messageId" TEXT NOT NULL,
  "reporterUserId" TEXT NOT NULL, "targetUserId" TEXT NOT NULL, "reason" TEXT NOT NULL,
  "details" TEXT, "evidenceSnapshot" JSONB NOT NULL, "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT, "reviewedAt" TIMESTAMP(3), "resolutionNote" TEXT,
  "evidenceHoldUntil" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatReport_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatReport_pending_reporter_message_key" ON "ChatReport"("messageId", "reporterUserId") WHERE "status" = 'pending';
CREATE INDEX "ChatReport_status_createdAt_idx" ON "ChatReport"("status", "createdAt");
CREATE INDEX "ChatReport_reporterUserId_createdAt_idx" ON "ChatReport"("reporterUserId", "createdAt");
CREATE INDEX "ChatReport_targetUserId_createdAt_idx" ON "ChatReport"("targetUserId", "createdAt");
CREATE INDEX "ChatReport_messageId_reporterUserId_status_idx" ON "ChatReport"("messageId", "reporterUserId", "status");

ALTER TABLE "ChatPrivacySetting" ADD CONSTRAINT "ChatPrivacySetting_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_addresseeId_fkey" FOREIGN KEY ("addresseeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserBlock" ADD CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_userLowId_fkey" FOREIGN KEY ("userLowId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectConversation" ADD CONSTRAINT "DirectConversation_userHighId_fkey" FOREIGN KEY ("userHighId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectConversationMember" ADD CONSTRAINT "DirectConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectConversationMember" ADD CONSTRAINT "DirectConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_senderUserId_fkey" FOREIGN KEY ("senderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatUserEvent" ADD CONSTRAINT "ChatUserEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DirectMessage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatReport" ADD CONSTRAINT "ChatReport_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ChatPrivacySetting" ("userId", "allowExactUsernameDiscovery", "createdAt", "updatedAt")
SELECT "id", false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP FROM "User" ON CONFLICT ("userId") DO NOTHING;
