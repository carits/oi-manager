CREATE TABLE "ChatStickerPack" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'staged',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdByUserId" TEXT NOT NULL,
  "publishedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatStickerPack_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatStickerPack_status_check" CHECK ("status" IN ('staged', 'active', 'retired'))
);
CREATE UNIQUE INDEX "ChatStickerPack_key_version_key" ON "ChatStickerPack"("key", "version");
CREATE INDEX "ChatStickerPack_status_sortOrder_createdAt_idx" ON "ChatStickerPack"("status", "sortOrder", "createdAt");

CREATE TABLE "ChatSticker" (
  "id" TEXT NOT NULL,
  "packId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "assetBlobId" TEXT NOT NULL,
  "posterBlobId" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "frameCount" INTEGER NOT NULL DEFAULT 1,
  "durationMs" INTEGER NOT NULL DEFAULT 0,
  "sha256" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatSticker_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatSticker_status_check" CHECK ("status" IN ('active', 'retired')),
  CONSTRAINT "ChatSticker_dimensions_check" CHECK ("width" BETWEEN 1 AND 512 AND "height" BETWEEN 1 AND 512),
  CONSTRAINT "ChatSticker_animation_check" CHECK ("frameCount" BETWEEN 1 AND 120 AND "durationMs" BETWEEN 0 AND 8000)
);
CREATE UNIQUE INDEX "ChatSticker_packId_key_key" ON "ChatSticker"("packId", "key");
CREATE INDEX "ChatSticker_packId_status_sortOrder_idx" ON "ChatSticker"("packId", "status", "sortOrder");
CREATE INDEX "ChatSticker_assetBlobId_idx" ON "ChatSticker"("assetBlobId");
CREATE INDEX "ChatSticker_posterBlobId_idx" ON "ChatSticker"("posterBlobId");

CREATE TABLE "ChatStickerImport" (
  "id" TEXT NOT NULL,
  "uploadedByUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'staged',
  "reportHash" TEXT NOT NULL,
  "manifest" JSONB NOT NULL,
  "report" JSONB NOT NULL,
  "publishedPackId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatStickerImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ChatStickerImport_status_check" CHECK ("status" IN ('staged', 'published', 'failed', 'expired'))
);
CREATE INDEX "ChatStickerImport_status_createdAt_idx" ON "ChatStickerImport"("status", "createdAt");
CREATE INDEX "ChatStickerImport_expiresAt_idx" ON "ChatStickerImport"("expiresAt");

ALTER TABLE "DirectMessage" ADD COLUMN "messageType" TEXT NOT NULL DEFAULT 'text';
ALTER TABLE "DirectMessage" ADD COLUMN "stickerId" TEXT;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_type_check" CHECK (
  ("messageType" = 'text' AND "stickerId" IS NULL) OR
  ("messageType" = 'sticker' AND "stickerId" IS NOT NULL)
);
CREATE INDEX "DirectMessage_stickerId_idx" ON "DirectMessage"("stickerId");

ALTER TABLE "ChatStickerPack" ADD CONSTRAINT "ChatStickerPack_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatSticker" ADD CONSTRAINT "ChatSticker_packId_fkey" FOREIGN KEY ("packId") REFERENCES "ChatStickerPack"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatSticker" ADD CONSTRAINT "ChatSticker_assetBlobId_fkey" FOREIGN KEY ("assetBlobId") REFERENCES "BlobObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatSticker" ADD CONSTRAINT "ChatSticker_posterBlobId_fkey" FOREIGN KEY ("posterBlobId") REFERENCES "BlobObject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatStickerImport" ADD CONSTRAINT "ChatStickerImport_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ChatStickerImport" ADD CONSTRAINT "ChatStickerImport_publishedPackId_fkey" FOREIGN KEY ("publishedPackId") REFERENCES "ChatStickerPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DirectMessage" ADD CONSTRAINT "DirectMessage_stickerId_fkey" FOREIGN KEY ("stickerId") REFERENCES "ChatSticker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
