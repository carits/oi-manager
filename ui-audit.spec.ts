/**
 * UI 审计测试 — 检查页面布局、导航、双重 AppShell、异常跳转
 * 服务器: localhost:3000 / localhost:3002
 */
import { test, expect } from '@playwright/test'

const BASE_URL = 'http://localhost:3000'
const API_URL = 'http://localhost:3002'

let teacherToken: string | null = null
let studentToken: string | null = null
let teacherUserId: string | null = null
let studentUserId: string | null = null

async function getTeacherToken(request: any) {
  if (teacherToken) return teacherToken
  const res = await request.post(`${API_URL}/api/auth/login`, {
    data: { username: 'teacher1', password: '123456', role: 'teacher' }
  })
  const body = await res.json()
  expect(body.success).toBe(true)
  teacherToken = body.data.token
  teacherUserId = body.data.userId
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
  return studentToken!
}

async function setAuthToken(page: any, token: string, role: string, userId: string) {
  await page.goto(`${BASE_URL}/login`)
  await page.evaluate(({ t, r, u }) => {
    localStorage.setItem('token', t)
    localStorage.setItem('role', r)
    if (u) localStorage.setItem('userId', u)
    window.dispatchEvent(new Event('storage'))
  }, { t: token, r: role, u: userId })
  await page.waitForTimeout(500)
}

// ============================================================
// 1. 双重 AppShell 检测
// ============================================================
test.describe('1. 双重 AppShell 检测', () => {

  test('学生作业页只有一个导航栏', async ({ page }) => {
    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, 'student', studentUserId || '')
    await page.goto(`${BASE_URL}/student/homeworks`)
    await page.waitForTimeout(3000)

    // AppShell renders a <header> with sticky top nav
    const headers = page.locator('header')
    const headerCount = await headers.count()
    expect(headerCount).toBeLessThanOrEqual(1)
  })

  test('学生比赛页只有一个导航栏', async ({ page }) => {
    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, 'student', studentUserId || '')
    await page.goto(`${BASE_URL}/student/contests`)
    await page.waitForTimeout(3000)

    const headers = page.locator('header')
    const headerCount = await headers.count()
    expect(headerCount).toBeLessThanOrEqual(1)
  })

  test('学生排名页只有一个导航栏', async ({ page }) => {
    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, 'student', studentUserId || '')
    await page.goto(`${BASE_URL}/student/rating`)
    await page.waitForTimeout(3000)

    const headers = page.locator('header')
    const headerCount = await headers.count()
    expect(headerCount).toBeLessThanOrEqual(1)
  })

  test('教师作业页只有一个导航栏', async ({ page }) => {
    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, 'teacher', teacherUserId || '')
    await page.goto(`${BASE_URL}/teacher/homeworks`)
    await page.waitForTimeout(3000)

    const headers = page.locator('header')
    const headerCount = await headers.count()
    expect(headerCount).toBeLessThanOrEqual(1)
  })

  test('教师比赛页只有一个导航栏', async ({ page }) => {
    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, 'teacher', teacherUserId || '')
    await page.goto(`${BASE_URL}/teacher/contests`)
    await page.waitForTimeout(3000)

    const headers = page.locator('header')
    const headerCount = await headers.count()
    expect(headerCount).toBeLessThanOrEqual(1)
  })

  test('教师排名页只有一个导航栏', async ({ page }) => {
    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, 'teacher', teacherUserId || '')
    await page.goto(`${BASE_URL}/teacher/rankings`)
    await page.waitForTimeout(3000)

    const headers = page.locator('header')
    const headerCount = await headers.count()
    expect(headerCount).toBeLessThanOrEqual(1)
  })
})

// ============================================================
// 2. 导航流 — 学生端
// ============================================================
test.describe('2. 学生端导航流', () => {

  const studentPages = [
    { label: '团队', href: '/student/team' },
    { label: '作业', href: '/student/homeworks' },
    { label: '比赛', href: '/student/contests' },
    { label: '题单', href: '/student/problem-lists' },
    { label: '排名', href: '/student/rating' },
  ]

  for (const { label, href } of studentPages) {
    test(`学生导航 "${label}" (${href}) 可正常加载`, async ({ page }) => {
      const token = await getStudentToken(page.context().request)
      await setAuthToken(page, token, 'student', studentUserId || '')
      await page.goto(`${BASE_URL}${href}`)
      await page.waitForTimeout(3000)

      // 不应跳转到登录页
      expect(page.url()).not.toContain('/login')
      // 不应显示 404
      const bodyText = await page.locator('body').innerText()
      expect(bodyText).not.toContain('404')
      // 页面应有可见的 h1 标题
      const h1 = page.locator('h1')
      const h1Count = await h1.count()
      expect(h1Count).toBeGreaterThanOrEqual(1)
    })
  }

  test('学生导航项点击可跳转', async ({ page }) => {
    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, 'student', studentUserId || '')
    await page.goto(`${BASE_URL}/student/homeworks`)
    await page.waitForTimeout(3000)

    // 点击"排名"导航
    const navLink = page.locator(`nav a:has-text("排名")`)
    const count = await navLink.count()
    if (count > 0) {
      await navLink.first().click()
      await page.waitForTimeout(2000)
      expect(page.url()).toContain('/student/rating')
    }
  })
})

// ============================================================
// 3. 导航流 — 教师端
// ============================================================
test.describe('3. 教师端导航流', () => {

  const teacherPages = [
    { label: '学生管理', href: '/teacher/students' },
    { label: '团队', href: '/teacher/teams' },
    { label: '作业', href: '/teacher/homeworks' },
    { label: '比赛', href: '/teacher/contests' },
    { label: '题单', href: '/teacher/problem-lists' },
    { label: '排名', href: '/teacher/rankings' },
  ]

  for (const { label, href } of teacherPages) {
    test(`教师导航 "${label}" (${href}) 可正常加载`, async ({ page }) => {
      const token = await getTeacherToken(page.context().request)
      await setAuthToken(page, token, 'teacher', teacherUserId || '')
      await page.goto(`${BASE_URL}${href}`)
      await page.waitForTimeout(3000)

      expect(page.url()).not.toContain('/login')
      const bodyText = await page.locator('body').innerText()
      expect(bodyText).not.toContain('404')
      const h1 = page.locator('h1')
      const h1Count = await h1.count()
      expect(h1Count).toBeGreaterThanOrEqual(1)
    })
  }
})

// ============================================================
// 4. 排名页 Tab 切换
// ============================================================
test.describe('4. 排名页 Tab 切换', () => {

  test('学生排名页两个 Tab 可切换', async ({ page }) => {
    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, 'student', studentUserId || '')
    await page.goto(`${BASE_URL}/student/rating`)
    await page.waitForTimeout(3000)

    // 应有 tab 按钮
    const tabs = page.locator('button[role="tab"], button')
    const tabCount = await tabs.count()
    expect(tabCount).toBeGreaterThanOrEqual(2)

    // 点击第二个 tab
    await tabs.nth(1).click()
    await page.waitForTimeout(1000)

    // 页面不应崩溃
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('Error')
    expect(bodyText).not.toContain('404')
  })

  test('教师排名页两个 Tab 可切换', async ({ page }) => {
    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, 'teacher', teacherUserId || '')
    await page.goto(`${BASE_URL}/teacher/rankings`)
    await page.waitForTimeout(3000)

    const tabs = page.locator('button[role="tab"], button')
    const tabCount = await tabs.count()
    expect(tabCount).toBeGreaterThanOrEqual(2)

    await tabs.nth(1).click()
    await page.waitForTimeout(1000)

    const bodyText = await page.locator('body').innerText()
    expect(bodyText).not.toContain('Error')
    expect(bodyText).not.toContain('404')
  })
})

// ============================================================
// 5. 异常重定向检测
// ============================================================
test.describe('5. 异常重定向检测', () => {

  test('已登录学生访问学生页面不应跳转到登录页', async ({ page }) => {
    const token = await getStudentToken(page.context().request)
    await setAuthToken(page, token, 'student', studentUserId || '')

    const studentUrls = [
      '/student/homeworks',
      '/student/contests',
      '/student/rating',
      '/student/problem-lists',
      '/student/team',
    ]

    for (const url of studentUrls) {
      await page.goto(`${BASE_URL}${url}`)
      await page.waitForTimeout(2000)
      expect(page.url()).not.toContain('/login')
    }
  })

  test('已登录教师访问教师页面不应跳转到登录页', async ({ page }) => {
    const token = await getTeacherToken(page.context().request)
    await setAuthToken(page, token, 'teacher', teacherUserId || '')

    const teacherUrls = [
      '/teacher/homeworks',
      '/teacher/contests',
      '/teacher/rankings',
      '/teacher/problem-lists',
      '/teacher/teams',
      '/teacher/students',
    ]

    for (const url of teacherUrls) {
      await page.goto(`${BASE_URL}${url}`)
      await page.waitForTimeout(2000)
      expect(page.url()).not.toContain('/login')
    }
  })
})

// ============================================================
// 6. 页面标题检查
// ============================================================
test.describe('6. 页面标题检查', () => {

  const pagesWithTitle = [
    { href: '/student/homeworks', expectedTitle: '作业' },
    { href: '/student/contests', expectedTitle: '比赛' },
    { href: '/student/rating', expectedTitle: '排名' },
    { href: '/teacher/homeworks', expectedTitle: '作业' },
    { href: '/teacher/contests', expectedTitle: '比赛' },
    { href: '/teacher/rankings', expectedTitle: '排名' },
  ]

  for (const { href, expectedTitle } of pagesWithTitle) {
    test(`${href} 页面标题包含 "${expectedTitle}"`, async ({ page }) => {
      const isStudent = href.startsWith('/student')
      const token = isStudent
        ? await getStudentToken(page.context().request)
        : await getTeacherToken(page.context().request)
      const role = isStudent ? 'student' : 'teacher'
      const userId = isStudent ? studentUserId : teacherUserId
      await setAuthToken(page, token, role, userId || '')
      await page.goto(`${BASE_URL}${href}`)
      await page.waitForTimeout(3000)

      const h1 = page.locator('h1')
      const h1Text = await h1.first().innerText()
      expect(h1Text).toContain(expectedTitle)
    })
  }
})
