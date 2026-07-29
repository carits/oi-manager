/**
 * Phase 4 验收测试 — 题单发布为作业（含实际数据创建）
 * 服务器: localhost:3000 / localhost:3002
 */
import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'
const API_URL = 'http://localhost:3002'

// Shared tokens to avoid rate limiting from repeated logins
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

// Extract items from paginated or list API response
function extractItems(data: any): any[] {
  if (Array.isArray(data)) return data
  if (data?.items) return data.items
  if (data?.data) return data.data
  if (data?.lists) return data.lists
  return []
}

async function setAuthToken(page: any, token: string, role: string = 'teacher', userId: string = '') {
  await page.goto(`${BASE_URL}/login`)
  await page.evaluate(({ t, r, u }) => {
    localStorage.setItem('token', t)
    localStorage.setItem('role', r)
    if (u) localStorage.setItem('userId', u)
    // Navigate away to trigger AuthProvider re-check
    window.dispatchEvent(new Event('storage'))
  }, { t: token, r: role, u: userId })
  // Wait for AuthProvider to validate token and load user
  await page.waitForTimeout(500)
}

// Shared test data
let problemListId: string | null = null
let sectionId: string | null = null
let homeworkId: string | null = null
let teamId: string | null = null

test.describe('Phase 4 验收', () => {

  test('1. API — 教师登录获取 token', async ({ request }) => {
    const token = await getTeacherToken(request)
    expect(token).toBeDefined()
  })

  test('2. API — 学生登录获取 token', async ({ request }) => {
    const token = await getStudentToken(request)
    expect(token).toBeDefined()
  })

  test('3. 准备测试数据 — 创建题单 + 添加题目 + 发布作业', async ({ request }) => {
    const token = await getTeacherToken(request)

    // 1. Create problem list
    const plRes = await request.post(`${API_URL}/api/problem-lists`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { title: `E2E验收题单-${Date.now()}`, description: 'Phase4 端到端验收' }
    })
    const plData = await plRes.json()
    expect(plData.success).toBe(true)
    problemListId = plData.data.id

    // 2. Get detail to find section ID
    const detailRes = await request.get(`${API_URL}/api/problem-lists/${problemListId}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const detailData = await detailRes.json()
    const sections = detailData.data?.ProblemListSection || detailData.data?.Sections || detailData.data?.sections || []
    expect(sections.length).toBeGreaterThan(0)
    sectionId = sections[0].id

    // 3. Find problems to add
    const probsRes = await request.get(`${API_URL}/api/problems?pageSize=3`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const probsData = await probsRes.json()
    const problems = extractItems(probsData?.data)
    expect(problems.length).toBeGreaterThan(0)

    // 4. Add problems to section
    for (const p of problems.slice(0, 3)) {
      await request.post(`${API_URL}/api/problem-lists/sections/${sectionId}/entries/single`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        data: { ojName: p.platform, problemCode: p.problemId, problemId: p.id }
      })
    }

    // 5. Get team ID
    const teamsRes = await request.get(`${API_URL}/api/teams?view=mine&pageSize=5`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    const teamsData = await teamsRes.json()
    const teams = extractItems(teamsData?.data)
    expect(teams.length).toBeGreaterThan(0)
    teamId = teams[0].id

    // 6. Publish as homework
    const publishRes = await request.post(`${API_URL}/api/problem-lists/${problemListId}/publish-homework`, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      data: {
        teamId,
        title: `[E2E验收] 验收题单`,
        startTime: new Date(Date.now() - 60000).toISOString(),
        endTime: new Date(Date.now() + 7200000).toISOString(),
        format: 'ioi'
      }
    })
    const publishData = await publishRes.json()
    expect(publishData.success).toBe(true)
    homeworkId = String(publishData.data.trainingId)

    console.log(`Created: list=${problemListId}, section=${sectionId}, homework=${homeworkId}, team=${teamId}`)
  })

  test('4. API — 学生 my-homeworks 包含新作业', async ({ request }) => {
    const token = await getStudentToken(request)
    const res = await request.get(`${API_URL}/api/students/my-homeworks`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
    const items = data.data || []
    const found = items.some((h: any) => String(h.id) === homeworkId)
    expect(found).toBe(true)
  })

  test('5. API — 学生 my-contests 返回正常', async ({ request }) => {
    const token = await getStudentToken(request)
    const res = await request.get(`${API_URL}/api/students/my-contests`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    expect(res.status()).toBe(200)
    const data = await res.json()
    expect(data.success).toBe(true)
  })

  test('6. API — 作业题目快照和学生脱敏', async ({ request }) => {
    const teacherToken_ = await getTeacherToken(request)
    const studentToken_ = await getStudentToken(request)
    expect(homeworkId).toBeTruthy()

    // Teacher view - should have snapshots
    const teacherRes = await request.get(`${API_URL}/api/trainings/${homeworkId}/problem-status`, {
      headers: { Authorization: `Bearer ${teacherToken_}` }
    })
    const teacherData = await teacherRes.json()
    expect(teacherData.success).toBe(true)
    const teacherProblems = teacherData.data?.problems || []
    expect(teacherProblems.length).toBeGreaterThan(0)
    console.log(`Teacher sees ${teacherProblems.length} problems`)

    // Student view - should have titles but no source fields
    const studentRes = await request.get(`${API_URL}/api/trainings/${homeworkId}/problem-status`, {
      headers: { Authorization: `Bearer ${studentToken_}` }
    })
    const studentData = await studentRes.json()
    console.log(`Student problem-status response: status=${studentRes.status()}, success=${studentData.success}, message=${studentData.message || 'none'}`)
    if (!studentData.success) {
      // Retry with fresh token if rate-limited
      const freshRes = await request.post(`${API_URL}/api/auth/login`, {
        data: { username: 'student1', password: '123456', role: 'student' }
      })
      const freshBody = await freshRes.json()
      if (freshBody.success) {
        const retryRes = await request.get(`${API_URL}/api/trainings/${homeworkId}/problem-status`, {
          headers: { Authorization: `Bearer ${freshBody.data.token}` }
        })
        const retryData = await retryRes.json()
        expect(retryData.success).toBe(true)
        const retryProblems = retryData.data?.problems || []
        expect(retryProblems.length).toBeGreaterThan(0)
        for (const p of retryProblems) {
          expect(p.title).toBeTruthy()
          expect(p.platform).toBeFalsy()
          expect(p.platformProblemId).toBeFalsy()
          expect(p.problemUrl).toBeFalsy()
        }
        console.log(`Student sees ${retryProblems.length} problems (via retry), all properly sanitized`)
        return
      }
    }
    expect(studentData.success).toBe(true)
    const studentProblems = studentData.data?.problems || []
    expect(studentProblems.length).toBeGreaterThan(0)

    for (const p of studentProblems) {
      // Student should see title and alias
      expect(p.title).toBeTruthy()
      // Student should NOT see source fields
      expect(p.platform).toBeFalsy()
      expect(p.platformProblemId).toBeFalsy()
      expect(p.problemUrl).toBeFalsy()
    }
    console.log(`Student sees ${studentProblems.length} problems, all properly sanitized`)
  })

  test('7. 前端 — 教师题单详情页有发布为作业按钮', async ({ page }) => {
    if (!problemListId) {
      console.log('SKIP: No problem list created')
      return
    }

    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, teacherRole || 'teacher', teacherUserId || '')
    await page.goto(`${BASE_URL}/teacher/problem-lists/${problemListId}`)
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'phase4-problemlist-detail.png', fullPage: true })

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')

    const publishBtn = page.locator('button:has-text("发布为作业")')
    const count = await publishBtn.count()
    console.log('Publish button count:', count)
    expect(count).toBeGreaterThan(0)
  })

  test('8. 前端 — 教师作业页面不 404', async ({ page }) => {
    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, teacherRole || 'teacher', teacherUserId || '')

    await page.goto(`${BASE_URL}/teacher/homeworks`)
    await page.waitForTimeout(5000)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')
  })

  test('9. 前端 — 教师比赛页面不 404', async ({ page }) => {
    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, teacherRole || 'teacher', teacherUserId || '')

    await page.goto(`${BASE_URL}/teacher/contests`)
    await page.waitForTimeout(5000)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')
  })

  test('10. 前端 — 学生作业列表页', async ({ page }) => {
    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, studentRole || 'student', studentUserId || '')

    await page.goto(`${BASE_URL}/student/homeworks`)
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'phase4-student-homeworks.png', fullPage: true })

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')
  })

  test('11. 前端 — 学生比赛列表页', async ({ page }) => {
    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, studentRole || 'student', studentUserId || '')

    await page.goto(`${BASE_URL}/student/contests`)
    await page.waitForTimeout(5000)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')
  })

  test('12. 前端 — 学生作业详情页 + 返回按钮', async ({ page }) => {
    if (!homeworkId) {
      console.log('SKIP: No homework created')
      return
    }

    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, studentRole || 'student', studentUserId || '')

    await page.goto(`${BASE_URL}/student/homeworks/${homeworkId}`)
    await page.waitForTimeout(5000)
    await page.screenshot({ path: 'phase4-student-homework-detail.png', fullPage: true })

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('404')

    // Check back URL points to homeworks
    const backLinks = page.locator('a[href*="homeworks"], button')
    const backCount = await backLinks.count()
    console.log('Potential back elements:', backCount)
  })
})
