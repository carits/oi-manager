import path from 'path'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { prisma } from '../src/prisma'
import { resolveStoragePath, validateMimeForExtension, validateUploadedFileContent } from '../src/lib/file-security'
import { createTestApp } from './helpers/testRequest'
import { generateTestToken } from './helpers/testToken'
import { createTestSchool, createTestTeam, createTestUser } from './helpers/testUser'

const app = createTestApp()

function tokenFor(user: Awaited<ReturnType<typeof createTestUser>>) {
  return generateTestToken({
    userId: user.user.id,
    username: user.user.username,
    role: user.user.role,
    schoolId: user.schoolId,
  })
}

describe('file storage security', () => {
  it('rejects paths that only share the storage root string prefix', () => {
    const root = path.resolve('/srv/oi/storage')
    expect(resolveStoragePath(root, 'public/avatar.png')).toBe(path.join(root, 'public/avatar.png'))
    expect(() => resolveStoragePath(root, '../storage-evil/secret')).toThrow(/path traversal/)
    expect(() => resolveStoragePath(root, '/etc/passwd')).toThrow(/path traversal/)
  })

  it('rejects forged binary uploads and binary data disguised as text', () => {
    expect(() => validateUploadedFileContent(Buffer.from('not a png'), 'avatar.png')).toThrow(/does not match/)
    expect(() => validateUploadedFileContent(Buffer.from([0x41, 0x00, 0x42]), 'answer.txt')).toThrow(/does not match/)
    expect(() => validateUploadedFileContent(Buffer.from('%PDF-1.7\n'), 'statement.pdf')).not.toThrow()
    expect(() => validateUploadedFileContent(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'avatar.png')).not.toThrow()
    expect(() => validateMimeForExtension('notes.txt', 'application/pdf')).toThrow(/MIME does not match/)
    expect(() => validateMimeForExtension('archive.zip', 'application/x-zip-compressed')).not.toThrow()
  })

  it('rejects a forged PNG through the multipart API', async () => {
    const user = await createTestUser({ role: 'student' })
    const response = await request(app)
      .post('/api/files/upload')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .attach('file', Buffer.from('not a png'), { filename: 'avatar.png', contentType: 'image/png' })
      .field('category', 'avatar')
      .field('ownerType', 'user')
      .field('ownerId', user.user.id)

    expect(response.status).toBe(400)
    expect(response.body.message).toMatch(/does not match/)
  })

  it('requires active membership and the matching organization for team files', async () => {
    const schoolA = await createTestSchool({ name: 'File School A' })
    const schoolB = await createTestSchool({ name: 'File School B' })
    const member = await createTestUser({ role: 'teacher', schoolId: schoolA.id })
    const team = await createTestTeam({ schoolId: schoolA.id, ownerId: member.user.id, ownerType: 'teacher' })

    const local = await request(app)
      .get(`/api/files/by-owner/team/${team.id}`)
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .set('x-oi-organization-id', schoolA.organizationId!)
    expect(local.status).toBe(200)

    await prisma.organizationMembership.create({
      data: {
        id: crypto.randomUUID(),
        organizationId: schoolB.organizationId!,
        userId: member.user.id,
        memberRole: 'teacher',
        relationType: 'employee',
        status: 'active',
        joinedAt: new Date(),
      },
    })
    const crossOrganization = await request(app)
      .get(`/api/files/by-owner/team/${team.id}`)
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .set('x-oi-organization-id', schoolB.organizationId!)
    expect(crossOrganization.status).toBe(403)

    await prisma.teamMember.updateMany({
      where: { teamId: team.id, userId: member.user.id },
      data: { status: 'removed' },
    })
    const inactive = await request(app)
      .get(`/api/files/by-owner/team/${team.id}`)
      .set('Authorization', `Bearer ${tokenFor(member)}`)
      .set('x-oi-organization-id', schoolA.organizationId!)
    expect(inactive.status).toBe(403)
  })

  it('does not let global administrators browse arbitrary user files', async () => {
    const owner = await createTestUser({ role: 'student' })
    const admin = await createTestUser({ role: 'platform_admin' })
    const response = await request(app)
      .get(`/api/files/by-owner/user/${owner.user.id}`)
      .set('Authorization', `Bearer ${tokenFor(admin)}`)

    expect(response.status).toBe(403)
  })

  it('hides soft-deleted public file metadata from authenticated callers', async () => {
    const user = await createTestUser({ role: 'student' })
    const file = await prisma.file.create({
      data: {
        id: crypto.randomUUID(),
        relativePath: 'public/avatars',
        fileName: 'deleted.png',
        originalName: 'deleted.png',
        mimeType: 'image/png',
        fileSize: 8,
        isPublic: true,
        accessLevel: 'public',
        ownerType: 'user',
        ownerId: user.user.id,
        category: 'avatar',
        status: 'deleted',
        deletedAt: new Date(),
      },
    })
    const response = await request(app)
      .get(`/api/files/${file.id}`)
      .set('Authorization', `Bearer ${tokenFor(user)}`)
    expect(response.status).toBe(404)
  })
})
