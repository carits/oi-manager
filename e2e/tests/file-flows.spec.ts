import { expect, test } from '@playwright/test'
import { bearer, loginAs } from '../fixtures/api'
import { loadFixtureIds } from '../fixtures/data'
import { fileFixtures } from '../fixtures/files'

const ids = loadFixtureIds()

test.describe('isolated file upload and download', () => {
  test('accepts PNG, PDF, text and ZIP fixtures', async ({ request }) => {
    const admin = await loginAs(request, 'superAdmin')
    const cases = [
      { file: fileFixtures.png, category: 'image' },
      { file: fileFixtures.pdf, category: 'pdf' },
      { file: fileFixtures.text, category: 'attachment' },
      { file: fileFixtures.zip, category: 'attachment' },
    ]

    for (const item of cases) {
      const upload = await request.post('/api/files/upload', {
        headers: bearer(admin),
        multipart: {
          file: item.file,
          category: item.category,
          ownerType: 'problem',
          ownerId: ids.problem,
          isPublic: 'false',
        },
      })
      expect(upload.status(), `${item.file.name} upload`).toBe(200)
      const uploaded = await upload.json()
      expect(uploaded.success).toBe(true)

      const download = await request.get(`/api/files/${uploaded.data.id}/download`, {
        headers: bearer(admin),
      })
      expect(download.status(), `${item.file.name} download`).toBe(200)
      expect(Buffer.from(await download.body())).toEqual(item.file.buffer)
    }
  })

  test('rejects an invalid extension as a client error', async ({ request }) => {
    const admin = await loginAs(request, 'superAdmin')
    const upload = await request.post('/api/files/upload', {
      headers: bearer(admin),
      multipart: {
        file: {
          name: 'payload.exe',
          mimeType: 'application/octet-stream',
          buffer: Buffer.from('not executable', 'utf8'),
        },
        category: 'image',
        ownerType: 'problem',
        ownerId: ids.problem,
      },
    })

    expect(upload.status()).toBe(400)
    const body = await upload.json()
    expect(body.success).toBe(false)
    expect(body.message).toMatch(/not allowed/i)
  })
})
