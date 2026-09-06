import crypto from 'node:crypto'
import { prisma } from '../../prisma'
import { getTestdataBlobStore } from './blob-store'

export async function putReferencedBlob(input: { content: Buffer | string; ownerType: string; ownerId: string; role: string; contentType?: string }) {
  const content = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content)
  const sha256 = crypto.createHash('sha256').update(content).digest('hex'), storageKey = `global/objects/${sha256}`
  await getTestdataBlobStore().put(storageKey, content, { ifAbsent: true, contentType: input.contentType })
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`content-blob:${sha256}`}, 0)) IS NULL AS locked`
    const blob = await tx.blobObject.upsert({ where: { sha256 }, update: { deleteAfter: null, storageTier: 'hot' }, create: { id: crypto.randomUUID(), sha256, size: content.length, storageKey, contentType: input.contentType } })
    await tx.blobReference.upsert({ where: { ownerType_ownerId_role: { ownerType: input.ownerType, ownerId: input.ownerId, role: input.role } }, update: { blobId: blob.id }, create: { id: crypto.randomUUID(), blobId: blob.id, ownerType: input.ownerType, ownerId: input.ownerId, role: input.role } })
    return blob
  })
}

export async function releaseBlobReferences(ownerType: string, ownerId: string) {
  return prisma.$transaction(async tx => {
    const refs = await tx.blobReference.findMany({ where: { ownerType, ownerId }, select: { blobId: true } })
    await tx.blobReference.deleteMany({ where: { ownerType, ownerId } })
    if (refs.length) await tx.blobObject.updateMany({ where: { id: { in: refs.map(item => item.blobId) }, References: { none: {} } }, data: { deleteAfter: new Date(Date.now() + 30 * 24 * 60 * 60_000) } })
    return refs.length
  })
}

export async function collectOrphanContentBlobs(input: { dryRun?: boolean; limit?: number } = {}) {
  const candidates = await prisma.blobObject.findMany({ where: { deleteAfter: { lte: new Date() } }, orderBy: { deleteAfter: 'asc' }, take: Math.min(Math.max(input.limit || 500, 1), 2_000) })
  let deleted = 0, errors = 0
  for (const candidate of candidates) {
    if (input.dryRun) continue
    try {
      deleted += await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`content-blob:${candidate.sha256}`}, 0)) IS NULL AS locked`
        if (await tx.blobReference.count({ where: { blobId: candidate.id } })) return 0
        await getTestdataBlobStore().delete(candidate.storageKey)
        const changed = await tx.blobObject.deleteMany({ where: { id: candidate.id, References: { none: {} } } })
        return changed.count
      })
    } catch { errors++ }
  }
  return { scanned: candidates.length, deleted, errors, dryRun: Boolean(input.dryRun) }
}
