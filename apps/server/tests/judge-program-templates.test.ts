import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createTestApp } from './helpers/testRequest'
import { createTestUser } from './helpers/testUser'
import { generateTestToken } from './helpers/testToken'

const app = createTestApp()

async function authenticatedToken() {
  const { user } = await createTestUser({ role: 'platform_admin' })
  return generateTestToken({ userId: user.id, username: user.username, role: 'platform_admin' })
}

describe('Judge program template API', () => {
  it('requires an authenticated account', async () => {
    const response = await request(app).get('/api/judge-program-templates')

    expect(response.status).toBe(401)
  })

  it('returns compact summaries without source or fixture payloads', async () => {
    const token = await authenticatedToken()
    const response = await request(app)
      .get('/api/judge-program-templates')
      .set('Cookie', `oi_session=${token}`)

    expect(response.status).toBe(200)
    expect(response.body.data.templates).toHaveLength(8)
    for (const template of response.body.data.templates) {
      expect(template.fixtureCount).toBeGreaterThan(0)
      expect(template.learningNoteCount).toBeGreaterThan(0)
      expect(template.requiredChangeCount).toBeGreaterThan(0)
      expect(template).not.toHaveProperty('source')
      expect(template).not.toHaveProperty('examples')
      expect(template).not.toHaveProperty('protocolConfig')
    }

    const generators = response.body.data.templates.filter((item: { kind: string }) => item.kind === 'generator')
    expect(generators).toHaveLength(2)
    expect(generators.every((item: { profileCount: number; hasProtocolConfig: boolean }) => item.profileCount === 2 && item.hasProtocolConfig)).toBe(true)
  })

  it('returns complete source, fixtures and teaching metadata from detail', async () => {
    const token = await authenticatedToken()
    const response = await request(app)
      .get('/api/judge-program-templates/classifier-cpp17-v1')
      .set('Cookie', `oi_session=${token}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      kind: 'classifier',
      language: 'cpp17',
      version: 2,
    })
    expect(response.body.data.source).toContain('{\\\"subtasks\\\"')
    expect(response.body.data.examples).toHaveLength(3)
    expect(response.body.data.examples.map((item: { expectedSubtasks: number[] }) => item.expectedSubtasks)).toEqual([[1, 2, 3], [1, 3], [3]])
    expect(response.body.data.learningNotes.length).toBeGreaterThan(0)
    expect(response.body.data.requiredChanges.join(' ')).toContain('Subtask')
  })

  it('returns a complete Generator v1 bundle', async () => {
    const token = await authenticatedToken()
    const response = await request(app)
      .get('/api/judge-program-templates/generator-python3-v1')
      .set('Cookie', `oi_session=${token}`)

    expect(response.status).toBe(200)
    expect(response.body.data.protocol).toBe('oj.generator/v1')
    expect(response.body.data.protocolConfig.profiles.map((item: { id: string }) => item.id)).toEqual(['random', 'max'])
    expect(response.body.data.protocolConfig.parameterSchema).toHaveProperty('nMin')
    expect(response.body.data.protocolConfig.parameterSchema).toHaveProperty('nMax')
    expect(response.body.data.examples).toHaveLength(2)
    expect(() => JSON.parse(response.body.data.examples[0].stdin)).not.toThrow()
  })

  it('returns 404 for an unknown template', async () => {
    const token = await authenticatedToken()
    const response = await request(app)
      .get('/api/judge-program-templates/not-a-template')
      .set('Cookie', `oi_session=${token}`)

    expect(response.status).toBe(404)
    expect(response.body.code).toBe('PROGRAM_TEMPLATE_NOT_FOUND')
  })
})
