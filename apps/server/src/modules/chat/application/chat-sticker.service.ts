import crypto, { randomUUID } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import sharp from 'sharp'
import yauzl from 'yauzl'
import { prisma } from '../../../prisma'
import { getTestdataBlobStore } from '../../storage/blob-store'
import { putReferencedBlob, releaseBlobReferences } from '../../storage/content-blob.service'
import { ChatError, fail } from './chat-errors'

const MAX_ZIP_BYTES = 100 * 1024 * 1024
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024
const MAX_STICKERS = 240
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024
const MAX_FRAMES = 120
const MAX_DURATION_MS = 8_000
const MAX_ACTIVE_PACKS = 20
const IMPORT_TTL_MS = 24 * 60 * 60_000
const KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/

type ManifestSticker = { key: string; label: string; file: string; order?: number }
type StickerManifest = {
  schemaVersion: 1
  pack: { key: string; name: string; version: number; sortOrder?: number }
  stickers: ManifestSticker[]
}
type StagedSticker = ManifestSticker & {
  assetBlobId: string
  posterBlobId: string
  mimeType: 'image/webp'
  width: number
  height: number
  frameCount: number
  durationMs: number
  sha256: string
  size: number
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`
  return JSON.stringify(value)
}

function validateManifest(value: unknown): StickerManifest {
  const manifest = value as StickerManifest
  if (!manifest || manifest.schemaVersion !== 1 || !manifest.pack || !Array.isArray(manifest.stickers)) fail(422, 'INVALID_STICKER_MANIFEST', '表情包清单格式无效')
  const packKey = typeof manifest.pack.key === 'string' ? manifest.pack.key.trim() : ''
  const name = typeof manifest.pack.name === 'string' ? manifest.pack.name.trim() : ''
  const version = Number(manifest.pack.version)
  if (!KEY.test(packKey) || !name || name.length > 80 || !Number.isSafeInteger(version) || version < 1) fail(422, 'INVALID_STICKER_MANIFEST', '表情包名称、标识或版本无效')
  if (!manifest.stickers.length || manifest.stickers.length > MAX_STICKERS) fail(422, 'INVALID_STICKER_MANIFEST', `每个表情包必须包含 1～${MAX_STICKERS} 个表情`)
  const seen = new Set<string>()
  const stickers = manifest.stickers.map((item, index) => {
    const key = typeof item?.key === 'string' ? item.key.trim() : ''
    const label = typeof item?.label === 'string' ? item.label.trim() : ''
    const file = typeof item?.file === 'string' ? item.file.replace(/\\/g, '/').trim() : ''
    if (!KEY.test(key) || seen.has(key) || !label || label.length > 40 || !safeZipPath(file) || !/\.(png|webp|gif)$/i.test(file)) fail(422, 'INVALID_STICKER_MANIFEST', `第 ${index + 1} 个表情配置无效`)
    seen.add(key)
    return { key, label, file, order: Number.isSafeInteger(item.order) ? Number(item.order) : index }
  })
  return { schemaVersion: 1, pack: { key: packKey, name, version, sortOrder: Number.isSafeInteger(manifest.pack.sortOrder) ? Number(manifest.pack.sortOrder) : 0 }, stickers }
}

function safeZipPath(value: string) {
  if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || value.includes('\0')) return false
  return value.split('/').every(part => Boolean(part) && part !== '.' && part !== '..')
}

function openZip(buffer: Buffer): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => yauzl.fromBuffer(buffer, { lazyEntries: true, autoClose: true, strictFileNames: true }, (error, zip) => error || !zip ? reject(error || new Error('ZIP 无法打开')) : resolve(zip)))
}

function readEntry(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => zip.openReadStream(entry, (error, stream) => {
    if (error || !stream) return reject(error || new Error('ZIP 条目无法读取'))
    const chunks: Buffer[] = []; let size = 0
    stream.on('data', chunk => { size += chunk.length; if (size > MAX_UNCOMPRESSED_BYTES) stream.destroy(new Error('ZIP 条目过大')); else chunks.push(Buffer.from(chunk)) })
    stream.on('error', reject); stream.on('end', () => resolve(Buffer.concat(chunks)))
  }))
}

async function unzip(buffer: Buffer) {
  if (!buffer.length || buffer.length > MAX_ZIP_BYTES) fail(413, 'STICKER_ARCHIVE_TOO_LARGE', '表情包 ZIP 最大 100 MiB')
  const zip = await openZip(buffer)
  return new Promise<Map<string, Buffer>>((resolve, reject) => {
    const files = new Map<string, Buffer>(); let total = 0; let settled = false
    const stop = (error: unknown) => { if (settled) return; settled = true; try { zip.close() } catch { /* noop */ }; reject(error) }
    zip.on('entry', async entry => {
      try {
        const name = entry.fileName.replace(/\\/g, '/')
        if (!safeZipPath(name)) throw new ChatError(422, 'INVALID_STICKER_ARCHIVE', '压缩包包含不安全路径')
        const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
        if ((unixMode & 0o170000) === 0o120000) throw new ChatError(422, 'INVALID_STICKER_ARCHIVE', '压缩包不能包含链接')
        if (name.endsWith('/')) return zip.readEntry()
        if (entry.isEncrypted()) throw new ChatError(422, 'INVALID_STICKER_ARCHIVE', '压缩包不能加密')
        if (files.has(name) || files.size >= MAX_STICKERS + 1) throw new ChatError(422, 'INVALID_STICKER_ARCHIVE', '压缩包文件重复或数量过多')
        total += entry.uncompressedSize
        if (total > MAX_UNCOMPRESSED_BYTES) throw new ChatError(413, 'STICKER_ARCHIVE_TOO_LARGE', '表情包解压后最大 100 MiB')
        files.set(name, await readEntry(zip, entry)); zip.readEntry()
      } catch (error) { stop(error) }
    })
    zip.on('error', stop)
    zip.on('end', () => { if (!settled) { settled = true; resolve(files) } })
    zip.readEntry()
  })
}

async function normalizeImage(source: Buffer, fileName: string) {
  const metadata = await sharp(source, { animated: true, limitInputPixels: 512 * 512 * MAX_FRAMES }).metadata().catch(() => { throw new ChatError(422, 'INVALID_STICKER_IMAGE', '表情图片损坏或格式不受支持') })
  const displayHeight = metadata.pageHeight || metadata.height
  if (!['png', 'webp', 'gif'].includes(metadata.format || '') || !metadata.width || !displayHeight || metadata.width > 512 || displayHeight > 512) fail(422, 'INVALID_STICKER_IMAGE', '表情图片必须是最大 512×512 的 PNG、WebP 或 GIF')
  const expectedFormat = fileName.toLowerCase().endsWith('.png') ? 'png' : fileName.toLowerCase().endsWith('.gif') ? 'gif' : 'webp'
  if (metadata.format !== expectedFormat) fail(422, 'STICKER_IMAGE_TYPE_MISMATCH', `表情文件扩展名与实际格式不一致：${fileName}`)
  const frameCount = metadata.pages || 1
  const durationMs = Array.isArray(metadata.delay) ? metadata.delay.reduce((sum, delay) => sum + delay, 0) : 0
  if (frameCount > MAX_FRAMES || durationMs > MAX_DURATION_MS) fail(422, 'INVALID_STICKER_ANIMATION', '动态表情最多 120 帧且不超过 8 秒')
  const asset = await sharp(source, { animated: frameCount > 1, limitInputPixels: 512 * 512 * MAX_FRAMES }).rotate().webp({ quality: 88, effort: 4 }).toBuffer()
  const poster = await sharp(source, { page: 0, limitInputPixels: 512 * 512 }).rotate().webp({ quality: 88, effort: 4 }).toBuffer()
  if (asset.length > MAX_OUTPUT_BYTES || poster.length > MAX_OUTPUT_BYTES) fail(422, 'STICKER_IMAGE_TOO_LARGE', '规范化后的单个表情最大 2 MiB')
  return { asset, poster, width: metadata.width, height: displayHeight, frameCount, durationMs, sha256: crypto.createHash('sha256').update(asset).digest('hex') }
}

export async function stageStickerImport(userId: string, archive: Buffer) {
  const files = await unzip(archive)
  const manifestBuffer = files.get('manifest.json')
  if (!manifestBuffer || manifestBuffer.length > 256 * 1024) throw new ChatError(422, 'INVALID_STICKER_MANIFEST', '压缩包根目录缺少有效 manifest.json')
  let decoded: unknown
  try { decoded = JSON.parse(manifestBuffer.toString('utf8')) } catch { fail(422, 'INVALID_STICKER_MANIFEST', 'manifest.json 不是合法 JSON') }
  const manifest = validateManifest(decoded)
  const importId = randomUUID(), staged: StagedSticker[] = []
  try {
    for (const item of manifest.stickers) {
      const source = files.get(item.file)
      if (!source) throw new ChatError(422, 'INVALID_STICKER_MANIFEST', `缺少表情文件：${item.file}`)
      const normalized = await normalizeImage(source, item.file)
      const assetBlob = await putReferencedBlob({ content: normalized.asset, ownerType: 'chat_sticker_import', ownerId: importId, role: `asset:${item.key}`, contentType: 'image/webp' })
      const posterBlob = normalized.frameCount === 1 && normalized.asset.equals(normalized.poster) ? assetBlob : await putReferencedBlob({ content: normalized.poster, ownerType: 'chat_sticker_import', ownerId: importId, role: `poster:${item.key}`, contentType: 'image/webp' })
      staged.push({ ...item, ...normalized, assetBlobId: assetBlob.id, posterBlobId: posterBlob.id, mimeType: 'image/webp', size: normalized.asset.length })
    }
    const report = { pack: manifest.pack, stickers: staged, totals: { count: staged.length, bytes: staged.reduce((sum, item) => sum + item.size, 0), animated: staged.filter(item => item.frameCount > 1).length } }
    const reportHash = crypto.createHash('sha256').update(canonical(report)).digest('hex')
    await prisma.$transaction([
      prisma.chatStickerImport.create({ data: { id: importId, uploadedByUserId: userId, reportHash, manifest: manifest as unknown as Prisma.InputJsonValue, report: report as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + IMPORT_TTL_MS) } }),
      prisma.platformAuditLog.create({ data: { id: randomUUID(), actorUserId: userId, action: 'chat_sticker_import_staged', targetType: 'ChatStickerImport', targetId: importId, metadata: { key: manifest.pack.key, version: manifest.pack.version, stickerCount: staged.length } } }),
    ])
    return { importId, reportHash, report }
  } catch (error) {
    await releaseBlobReferences('chat_sticker_import', importId).catch(() => undefined)
    throw error
  }
}

export async function publishStickerImport(userId: string, importId: string, rawHash: unknown) {
  const reportHash = typeof rawHash === 'string' ? rawHash : ''
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('chat-sticker-publish', 0))`
    const rows = await tx.$queryRaw<Array<{ id: string; status: string; reportHash: string; report: Prisma.JsonValue; expiresAt: Date; publishedPackId: string | null }>>`SELECT id, status, "reportHash", report, "expiresAt", "publishedPackId" FROM "ChatStickerImport" WHERE id=${importId} FOR UPDATE`
    const stagedImport = rows[0]
    if (!stagedImport) fail(404, 'STICKER_IMPORT_NOT_FOUND', '表情包导入记录不存在')
    if (stagedImport.status === 'published' && stagedImport.publishedPackId) return { packId: stagedImport.publishedPackId, alreadyPublished: true }
    if (stagedImport.status !== 'staged' || stagedImport.expiresAt <= new Date()) fail(409, 'STICKER_IMPORT_NOT_PUBLISHABLE', '表情包导入已失效')
    if (!reportHash || reportHash !== stagedImport.reportHash) fail(409, 'STICKER_IMPORT_STALE', '表情包检查报告已变化，请重新检查')
    const report = stagedImport.report as unknown as { pack: StickerManifest['pack']; stickers: StagedSticker[] }
    if (crypto.createHash('sha256').update(canonical(report)).digest('hex') !== stagedImport.reportHash) fail(409, 'STICKER_IMPORT_STALE', '表情包检查报告完整性校验失败')
    if (await tx.chatStickerPack.count({ where: { status: 'active', key: { not: report.pack.key } } }) >= MAX_ACTIVE_PACKS) fail(409, 'STICKER_PACK_LIMIT_REACHED', '同时最多启用 20 个表情包')
    if (await tx.chatStickerPack.findUnique({ where: { key_version: { key: report.pack.key, version: report.pack.version } } })) fail(409, 'STICKER_PACK_VERSION_EXISTS', '相同表情包版本已经存在')
    const previous = await tx.chatStickerPack.findMany({ where: { key: report.pack.key, status: 'active' }, select: { id: true } })
    if (previous.length) {
      await tx.chatStickerPack.updateMany({ where: { id: { in: previous.map(item => item.id) } }, data: { status: 'retired', retiredAt: new Date() } })
      await tx.chatSticker.updateMany({ where: { packId: { in: previous.map(item => item.id) } }, data: { status: 'retired' } })
    }
    const packId = randomUUID()
    await tx.chatStickerPack.create({ data: { id: packId, key: report.pack.key, name: report.pack.name, version: report.pack.version, sortOrder: report.pack.sortOrder || 0, status: 'active', createdByUserId: userId, publishedAt: new Date() } })
    for (const item of report.stickers) {
      const stickerId = randomUUID()
      await tx.chatSticker.create({ data: { id: stickerId, packId, key: item.key, label: item.label, assetBlobId: item.assetBlobId, posterBlobId: item.posterBlobId, mimeType: item.mimeType, width: item.width, height: item.height, frameCount: item.frameCount, durationMs: item.durationMs, sha256: item.sha256, sortOrder: item.order || 0 } })
      await tx.blobReference.createMany({ data: [
        { id: randomUUID(), blobId: item.assetBlobId, ownerType: 'chat_sticker', ownerId: stickerId, role: 'asset' },
        { id: randomUUID(), blobId: item.posterBlobId, ownerType: 'chat_sticker', ownerId: stickerId, role: 'poster' },
      ], skipDuplicates: true })
    }
    await tx.chatStickerImport.update({ where: { id: importId }, data: { status: 'published', publishedPackId: packId } })
    await tx.platformAuditLog.create({ data: { id: randomUUID(), actorUserId: userId, action: 'chat_sticker_pack_published', targetType: 'ChatStickerPack', targetId: packId, metadata: { key: report.pack.key, version: report.pack.version, stickerCount: report.stickers.length } } })
    return { packId, alreadyPublished: false }
  })
  await releaseBlobReferences('chat_sticker_import', importId)
  return result
}

export async function listActiveStickerPacks() {
  const packs = await prisma.chatStickerPack.findMany({ where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], include: { Stickers: { where: { status: 'active' }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } })
  return packs.map(pack => ({ id: pack.id, key: pack.key, name: pack.name, version: pack.version, stickers: pack.Stickers.map(stickerDto) })).filter(pack => pack.stickers.length > 0)
}

export async function listStickerPacksForAdmin() {
  return prisma.chatStickerPack.findMany({ orderBy: [{ createdAt: 'desc' }], include: { _count: { select: { Stickers: true } }, CreatedBy: { select: { username: true } } } })
}

export async function retireStickerPack(userId: string, packId: string) {
  return prisma.$transaction(async tx => {
    const pack = await tx.chatStickerPack.findUnique({ where: { id: packId } })
    if (!pack) throw new ChatError(404, 'STICKER_PACK_NOT_FOUND', '表情包不存在')
    if (pack.status === 'retired') return pack
    const updated = await tx.chatStickerPack.update({ where: { id: packId }, data: { status: 'retired', retiredAt: new Date(), Stickers: { updateMany: { where: {}, data: { status: 'retired' } } } } })
    await tx.platformAuditLog.create({ data: { id: randomUUID(), actorUserId: userId, action: 'chat_sticker_pack_retired', targetType: 'ChatStickerPack', targetId: packId, metadata: { key: pack.key, version: pack.version } } })
    return updated
  })
}

export function stickerDto(sticker: { id: string; label: string; width: number; height: number; frameCount: number }) {
  return { id: sticker.id, label: sticker.label, assetUrl: `/api/chat/stickers/${sticker.id}/content`, posterUrl: `/api/chat/stickers/${sticker.id}/poster`, width: sticker.width, height: sticker.height, animated: sticker.frameCount > 1 }
}

export async function getStickerContent(stickerId: string, poster: boolean) {
  const sticker = await prisma.chatSticker.findUnique({ where: { id: stickerId }, include: { AssetBlob: true, PosterBlob: true } })
  if (!sticker) throw new ChatError(404, 'STICKER_NOT_FOUND', '表情不存在')
  const blob = poster ? sticker.PosterBlob : sticker.AssetBlob
  return { content: await getTestdataBlobStore().get(blob.storageKey), contentType: blob.contentType || 'image/webp', sha256: blob.sha256 }
}

export async function resolveSendableSticker(stickerId: string) {
  return prisma.chatSticker.findFirst({ where: { id: stickerId, status: 'active', Pack: { status: 'active' } }, include: { Pack: true } })
}

export async function expireStagedStickerImports() {
  const expired = await prisma.chatStickerImport.findMany({ where: { status: 'staged', expiresAt: { lte: new Date() } }, take: 100, select: { id: true } })
  for (const item of expired) {
    await prisma.chatStickerImport.updateMany({ where: { id: item.id, status: 'staged' }, data: { status: 'expired' } })
    await releaseBlobReferences('chat_sticker_import', item.id)
  }
  return expired.length
}

export function serializeChatMessage<T extends { id: string; conversationId: string; senderUserId: string; clientMessageId: string; seq: number; content: string; messageType: string; stickerId: string | null; createdAt: Date; Sticker?: { id: string; label: string; width: number; height: number; frameCount: number } | null }>(message: T) {
  return { ...message, type: message.messageType === 'sticker' ? 'sticker' as const : 'text' as const, sticker: message.Sticker ? stickerDto(message.Sticker) : undefined }
}
