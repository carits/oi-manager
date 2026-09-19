import fs from 'fs'
import path from 'path'
import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TESTDATA_DIR } from '../src/modules/testdata/testdata-storage'
import { createTestApp } from './helpers/testRequest'
import { createTestProblem } from './helpers/problemListHelpers'
import { generateTokenFromUser } from './helpers/testToken'
import { createTestUser } from './helpers/testUser'

const app = createTestApp()

describe('testdata application service', () => {
  let token: string
  let problem: Awaited<ReturnType<typeof createTestProblem>>
  const createdProblemIds: string[] = []

  beforeEach(async () => {
    const administrator = await createTestUser({ accountRole: 'platform_admin' })
    token = generateTokenFromUser(administrator.user)
    problem = await createTestProblem({ ownerId: administrator.user.id })
    createdProblemIds.push(problem.id)
  })

  afterEach(() => {
    for (const problemId of createdProblemIds.splice(0)) {
      fs.rmSync(path.join(TESTDATA_DIR, problemId), { recursive: true, force: true })
      fs.rmSync(path.join(TESTDATA_DIR, '.staging', problemId), { recursive: true, force: true })
    }
  })

  const postFiles = (problemId: string, files: Array<{ name: string; content: string }>, replace = false) => {
    let call = request(app)
      .post(`/api/problems/${problemId}/testdata`)
      .set('Cookie', `oi_session=${token}`)
      .field('replace', String(replace))
    for (const file of files) call = call.attach('files', Buffer.from(file.content), file.name)
    return call
  }

  it('uploads, pairs, lists and downloads testdata', async () => {
    const uploaded = await postFiles(problem.id, [
      { name: '1.in', content: '1 2\n' },
      { name: '1.out', content: '3\n' },
    ])
    expect(uploaded.status).toBe(200)
    expect(uploaded.body.data.files).toHaveLength(2)

    const listed = await request(app)
      .get(`/api/problems/${problem.id}/testdata`)
      .set('Cookie', `oi_session=${token}`)
    expect(listed.status).toBe(200)
    expect(listed.body.data.pairs).toEqual([{ input: '1.in', output: '1.out' }])

    const input = listed.body.data.files.find((file: { filename: string }) => file.filename === '1.in')
    const downloaded = await request(app)
      .get(`/api/problems/${problem.id}/testdata/files/${input.id}/download`)
      .set('Cookie', `oi_session=${token}`)
    expect(downloaded.status).toBe(200)
    expect(Buffer.from(downloaded.body).toString()).toBe('1 2\n')
  })

  it('rejects conflicts unless replace is explicit and then updates content atomically', async () => {
    expect((await postFiles(problem.id, [{ name: '1.in', content: 'old\n' }])).status).toBe(200)
    const conflict = await postFiles(problem.id, [{ name: '1.in', content: 'new\n' }])
    expect(conflict.status).toBe(409)
    expect(conflict.body.code).toBe('TESTDATA_CONFLICT')

    const replaced = await postFiles(problem.id, [{ name: '1.in', content: 'new\n' }], true)
    expect(replaced.status).toBe(200)
    const downloaded = await request(app)
      .get(`/api/problems/${problem.id}/testdata/files/${replaced.body.data.files[0].id}/download`)
      .set('Cookie', `oi_session=${token}`)
    expect(Buffer.from(downloaded.body).toString()).toBe('new\n')
  })

  it('does not allow a file ID to cross problem boundaries', async () => {
    const other = await createTestProblem({ ownerId: problem.ownerId })
    createdProblemIds.push(other.id)
    const uploaded = await postFiles(problem.id, [{ name: '1.in', content: 'secret\n' }])
    const fileId = uploaded.body.data.files[0].id
    const response = await request(app)
      .get(`/api/problems/${other.id}/testdata/files/${fileId}/download`)
      .set('Cookie', `oi_session=${token}`)
    expect(response.status).toBe(404)
  })

  it('deletes an unreferenced file from metadata and storage together', async () => {
    const uploaded = await postFiles(problem.id, [{ name: 'unused.in', content: 'unused\n' }])
    const fileId = uploaded.body.data.files[0].id
    const deleted = await request(app)
      .delete(`/api/problems/${problem.id}/testdata/${fileId}`)
      .set('Cookie', `oi_session=${token}`)
    expect(deleted.status).toBe(200)

    const downloaded = await request(app)
      .get(`/api/problems/${problem.id}/testdata/files/${fileId}/download`)
      .set('Cookie', `oi_session=${token}`)
    expect(downloaded.status).toBe(404)
    expect(fs.existsSync(path.join(TESTDATA_DIR, problem.id, 'unused.in'))).toBe(false)
  })
})
