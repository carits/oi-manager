import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { collectOrphanContentBlobs, putReferencedBlob, releaseBlobReferences } from '../src/modules/storage/content-blob.service'

describe('global content blob lifecycle', () => {
  it('deduplicates physical content and only collects after every reference is released', async () => {
    const content = Buffer.from(`candidate-blob-${crypto.randomUUID()}`)
    const firstOwner = crypto.randomUUID(), secondOwner = crypto.randomUUID()
    const first = await putReferencedBlob({ content, ownerType: 'test', ownerId: firstOwner, role: 'input' })
    const second = await putReferencedBlob({ content, ownerType: 'test', ownerId: secondOwner, role: 'input' })
    expect(second.id).toBe(first.id)
    expect(await prisma.blobReference.count({ where: { blobId: first.id } })).toBe(2)

    await releaseBlobReferences('test', firstOwner)
    await prisma.blobObject.update({ where: { id: first.id }, data: { deleteAfter: new Date(0) } })
    await collectOrphanContentBlobs({ limit: 10 })
    expect(await prisma.blobObject.findUnique({ where: { id: first.id } })).not.toBeNull()

    await releaseBlobReferences('test', secondOwner)
    await prisma.blobObject.update({ where: { id: first.id }, data: { deleteAfter: new Date(0) } })
    const result = await collectOrphanContentBlobs({ limit: 10 })
    expect(result.deleted).toBeGreaterThanOrEqual(1)
    expect(await prisma.blobObject.findUnique({ where: { id: first.id } })).toBeNull()
  })
})
