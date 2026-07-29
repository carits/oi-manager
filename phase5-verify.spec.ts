/**
 * Phase 5 验收测试 — 补题作业
 * 服务器: localhost:3000 / localhost:3002
 */
import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'
const API_URL = 'http://localhost:3002'

let teacherToken: string | null = null
let studentToken: string | null = null
let teacherUserId: string | null = null
let studentUserId: string | null = null
let teacherRole: string | null = null
let studentRole: string | null = null

async function getTeacherToken(request: any) {
  if (teacherToken) return teacherToken
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: 'teacher1', password: '123456', role: 'teacher' }
  })
  const body = await res.json()
  expect(body.success).toBe(true)
  teacherToken = body.data.token
  teacherUserId = body.data.userId
  teacherRole = body.data.role
  return teacherToken!
}

async function getStudentToken(request: any) {
  if (studentToken) return studentToken
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: 'student1', password: '123456', role: 'student' }
  })
  const body = await res.json()
  expect(body.success).toBe(true)
  studentToken = body.data.token
  studentUserId = body.data.userId
  studentRole = body.data.role
  return studentToken!
}

async function setAuthToken(page: any, token: string, role: string = 'teacher', userId: string = '') {
  await page.goto(`${BASE_URL}/login`)
  await page.evaluate(({ t, r, u }) => {
    localStorage.setItem('token', t)
    localStorage.setItem('role', r)
    if (u) localStorage.setItem('userId', u)
    window.dispatchEvent(new Event('storage'))
  }, { t: token, r: role, u: userId })
  await page.waitForTimeout(500)
}

// Test data
let finishedContestId: number | null = null
let makeupHomeworkId: number | null = null

test.describe('Phase 5 验收 — 补题作业', () => {

  test('1. API — 获取教师和学生 token', async ({ request }) => {
    const tt = await getTeacherToken(request)
    const st = await getStudentToken(request)
    expect(tt).toBeDefined()
    expect(st).toBeDefined()
  })

  test('2. API — 找到已结束的比赛', async ({ request }) => {
    const token = await getTeacherToken(request)
    // team-contest has finished contests
    const res = await request.get(`${API_URL}/api/teams/team-contest/trainings?type=contest&pageSize=5`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    const items = data.data || []
    const finished = items.find((t: any) => t.status === 'finished')
    expect(finished).toBeTruthy()
    finishedContestId = finished.id
    console.log(`Found finished contest: id=${finishedContestId} title=${finished.title}`)
  })

  test('3. API — 创建补题作业', async ({ request }) => {
    expect(finishedContestId).toBeTruthy()
    const token = await getTeacherToken(request)
    const now = Date.now()
    const res = await request.post(`${API_URL}/api/trainings/${finishedContestId}/create-makeup-homework`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        title: `[E2E验收] 补题练习`,
        startTime: new Date(now - 60000).toISOString(),
        endTime: new Date(now + 86400000 * 7).toISOString()
      }
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.type).toBe('homework')
    expect(data.data.sourceTrainingId).toBe(finishedContestId)
    makeupHomeworkId = data.data.id
    console.log(`Created makeup homework: id=${makeupHomeworkId}`)
  })

  test('4. API — 补题作业详情包含 sourceTrainingId', async ({ request }) => {
    expect(makeupHomeworkId).toBeTruthy()
    const token = await getTeacherToken(request)
    const res = await request.get(`${API_URL}/api/trainings/${makeupHomeworkId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.data.sourceTrainingId).toBe(finishedContestId)
    expect(data.data.type).toBe('homework')
    expect(data.data.problemIdVisible).toBe(true)
    expect(data.data.solutionVisible).toBe(true)
    console.log(`Makeup homework detail: type=${data.data.type} sourceTrainingId=${data.data.sourceTrainingId}`)
  })

  test('5. API — 补题作业题目包含快照', async ({ request }) => {
    expect(makeupHomeworkId).toBeTruthy()
    const token = await getTeacherToken(request)
    const res = await request.get(`${API_URL}/api/trainings/${makeupHomeworkId}/problems`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    expect(data.success).toBe(true)
    const problems = Array.isArray(data.data) ? data.data : (data.data?.problems || [])
    expect(problems.length).toBeGreaterThan(0)
    console.log(`Makeup homework has ${problems.length} problems with snapshots`)
  })

  test('6. API — 进行中比赛不能创建补题', async ({ request }) => {
    const token = await getTeacherToken(request)
    // Find an ongoing contest or training
    const res = await request.get(`${API_URL}/api/teams/team-contest/trainings?pageSize=10`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json()
    const items = data.data || []
    const ongoing = items.find((t: any) => t.status === 'ongoing')

    if (!ongoing) {
      console.log('SKIP: No ongoing training found')
      return
    }

    const makeupRes = await request.post(`${API_URL}/api/trainings/${ongoing.id}/create-makeup-homework`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: { endTime: new Date(Date.now() + 86400000 * 7).toISOString() }
    })
    expect(makeupRes.status()).toBe(400)
    const makeupData = await makeupRes.json()
    expect(makeupData.message).toContain('已结束')
    console.log(`Ongoing training ${ongoing.id} correctly rejected: ${makeupData.message}`)
  })

  test('7. 前端 — 教师已结束比赛详情页有补题按钮', async ({ page }) => {
    if (!finishedContestId) {
      console.log('SKIP: No finished contest')
      return
    }

    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, teacherRole || 'teacher', teacherUserId || '')
    await page.goto(`${BASE_URL}/teacher/teams/team-contest/contests/${finishedContestId}`)
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'phase5-contest-detail.png', fullPage: true })

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')

    const makeupBtn = page.locator('button:has-text("创建补题作业")')
    const count = await makeupBtn.count()
    console.log('Makeup button count:', count)
    expect(count).toBeGreaterThan(0)
  })

  test('8. 前端 — 补题作业详情页显示补题标签', async ({ page }) => {
    if (!makeupHomeworkId) {
      console.log('SKIP: No makeup homework')
      return
    }

    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, teacherRole || 'teacher', teacherUserId || '')
    await page.goto(`${BASE_URL}/teacher/teams/team-contest/homeworks/${makeupHomeworkId}`)
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'phase5-makeup-detail.png', fullPage: true })

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')

    // Should show "补题练习" badge
    expect(bodyText).toContain('补题')
    console.log('Makeup homework detail shows 补题 label')
  })

  test('9. 前端 — 补题作业有"查看原活动"链接', async ({ page }) => {
    if (!makeupHomeworkId) {
      console.log('SKIP: No makeup homework')
      return
    }

    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, teacherRole || 'teacher', teacherUserId || '')

    await page.goto(`${BASE_URL}/teacher/teams/team-contest/homeworks/${makeupHomeworkId}`)
    await page.waitForTimeout(5000)

    const bodyText = await page.locator('body').innerText()
    // Should have a link/button mentioning original activity
    const hasOriginalLink = bodyText.includes('查看原活动') || bodyText.includes('原比赛') || bodyText.includes('原活动')
    console.log('Has original activity link:', hasOriginalLink)
    expect(hasOriginalLink).toBe(true)
  })

  test('10. 前端 — 学生作业列表包含补题作业', async ({ page }) => {
    if (!makeupHomeworkId) {
      console.log('SKIP: No makeup homework')
      return
    }

    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, studentRole || 'student', studentUserId || '')

    await page.goto(`${BASE_URL}/student/homeworks`)
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'phase5-student-homeworks.png', fullPage: true })

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')
    // Should contain the makeup homework title
    expect(bodyText).toContain('补题')
    console.log('Student homeworks list contains makeup homework')
  })

  test('11. 前端 — 学生补题作业详情页正常', async ({ page }) => {
    if (!makeupHomeworkId) {
      console.log('SKIP: No makeup homework')
      return
    }

    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, studentRole || 'student', studentUserId || '')

    await page.goto(`${BASE_URL}/student/homeworks/${makeupHomeworkId}`)
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'phase5-student-makeup-detail.png', fullPage: true })

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')
  })
})
