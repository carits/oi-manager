import { test, expect } from '@playwright/test'

// Tokens - obtained via login API
const TEACHER_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIwNTM0NjY2Zi00NGQ4LTQ5MWEtYjYyZS03NzFmZDk1ZWVmYWEiLCJyb2xlIjoic2Nob29sX3ByaW5jaXBhbCIsInVzZXJuYW1lIjoidGVhY2hlcjEiLCJ0ZWFjaGVySWQiOiIwNTM0NjY2Zi00NGQ4LTQ5MWEtYjYyZS03NzFmZDk1ZWVmYWEiLCJzY2hvb2xJZCI6InNjaG9vbC1kZWZhdWx0IiwiaWF0IjoxNzgyMzc4ODUzLCJleHAiOjE3ODI5ODM2NTN9.vAOSw-waYudZt3J2ENJ6MXDxNfbck-ZfEnikLW3_3EI'
const STUDENT_TOKEN = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI5YTJjYjAwZS0zNjZiLTRlMTItOTljYS00ODEwMjc2Yjc0ODgiLCJyb2xlIjoic3R1ZGVudCIsInVzZXJuYW1lIjoic3R1ZGVudDEiLCJzdHVkZW50SWQiOiI5YTJjYjAwZS0zNjZiLTRlMTItOTljYS00ODEwMjc2Yjc0ODgiLCJzY2hvb2xJZCI6InNjaG9vbC1kZWZhdWx0IiwiaWF0IjoxNzgyMzc4OTA3LCJleHAiOjE3ODI5ODM3MDd9.ZgQMPe5w5OHBjyuCXXw8kzWiRSkV6udYj7v9ixhmh5Y'

const TEACHER_USERID = '0534666f-44d8-491a-b62e-771fd95eefaa'
const STUDENT_USERID = '9a2cb00e-366b-4e12-99ca-4810276b7488'

const BASE_URL = 'http://localhost:3000'

async function setAuthToken(page: any, token: string, role: string, userId: string) {
  // 先访问应用同源页面，确保 localStorage 可写
  await page.goto(BASE_URL)
  await page.evaluate(({ token, role, userId }) => {
    localStorage.setItem('token', token)
    localStorage.setItem('role', role)
    localStorage.setItem('userId', userId)
  }, { token, role, userId })
}

test.describe('校园排名页 E2E 验证', () => {

  test('教师端 /teacher/rankings — 显示 Rating 和做题量两个 tab', async ({ page }) => {
    await setAuthToken(page, TEACHER_TOKEN, 'school_principal', TEACHER_USERID)
    await page.goto('/teacher/rankings')
    await page.waitForLoadState('networkidle')

    // 页面标题
    await expect(page.locator('h1')).toContainText('校内排名')

    // 两个 tab 按钮
    const tabs = page.locator('button')
    const tabTexts = await tabs.allTextContents()
    const hasRatingTab = tabTexts.some(t => t.includes('Rating'))
    const hasSolvedTab = tabTexts.some(t => t.includes('做题量'))
    expect(hasRatingTab).toBeTruthy()
    expect(hasSolvedTab).toBeTruthy()

    // 默认显示 Rating 排名 tab（表格应有数据）
    const ratingTable = page.locator('table')
    await expect(ratingTable).toBeVisible({ timeout: 5000 })

    // 表头应包含"排名"、"姓名"、"Rating"、"年级"
    const headerCells = await page.locator('th').allTextContents()
    expect(headerCells).toContain('排名')
    expect(headerCells).toContain('姓名')
    expect(headerCells.some(h => h.includes('Rating'))).toBeTruthy()
    expect(headerCells).toContain('年级')

    // 切换到做题量 tab
    await page.locator('button', { hasText: '做题量' }).click()
    await page.waitForTimeout(1000)

    // 做题量表格
    const solvedTable = page.locator('table')
    await expect(solvedTable).toBeVisible({ timeout: 5000 })

    // 表头应包含"排名"、"姓名"、"做题量"、"年级"
    const solvedHeaders = await page.locator('th').allTextContents()
    expect(solvedHeaders).toContain('排名')
    expect(solvedHeaders).toContain('姓名')
    expect(solvedHeaders).toContain('做题量')
    expect(solvedHeaders).toContain('年级')

    // 做题量列有数值
    const solvedCells = await page.locator('td').allTextContents()
    const hasNumbers = solvedCells.some(c => /^\d+$/.test(c.trim()))
    expect(hasNumbers).toBeTruthy()
  })

  test('学生端 /student/rating — 显示 Rating 和做题量两个 tab', async ({ page }) => {
    await setAuthToken(page, STUDENT_TOKEN, 'student', STUDENT_USERID)
    await page.goto('/student/rating')
    await page.waitForLoadState('networkidle')

    // 页面标题
    await expect(page.locator('h1')).toContainText('校内排名')

    // 两个 tab 按钮
    const tabs = page.locator('button')
    const tabTexts = await tabs.allTextContents()
    const hasRatingTab = tabTexts.some(t => t.includes('Rating'))
    const hasSolvedTab = tabTexts.some(t => t.includes('做题量'))
    expect(hasRatingTab).toBeTruthy()
    expect(hasSolvedTab).toBeTruthy()

    // 默认 Rating 排名 tab 有表格
    const ratingTable = page.locator('table')
    await expect(ratingTable).toBeVisible({ timeout: 5000 })

    // 切换到做题量
    await page.locator('button', { hasText: '做题量' }).click()
    await page.waitForTimeout(1000)

    const solvedTable = page.locator('table')
    await expect(solvedTable).toBeVisible({ timeout: 5000 })

    // 做题量表头
    const solvedHeaders = await page.locator('th').allTextContents()
    expect(solvedHeaders).toContain('做题量')
  })

  test('做题量排名 — 包含已毕业学生筛选', async ({ page }) => {
    await setAuthToken(page, TEACHER_TOKEN, 'school_principal', TEACHER_USERID)
    await page.goto('/teacher/rankings')
    await page.waitForLoadState('networkidle')

    // 切换到做题量 tab
    await page.locator('button', { hasText: '做题量' }).click()
    await page.waitForTimeout(1000)

    // 应有"包含已毕业学生"复选框
    const checkbox = page.locator('input[type="checkbox"]')
    await expect(checkbox).toBeVisible()

    // 初始未选中
    expect(await checkbox.isChecked()).toBeFalsy()

    // 点击选中
    await checkbox.click()
    expect(await checkbox.isChecked()).toBeTruthy()
  })

  test('后端 API — student-solved-rankings 返回正确结构', async ({ request }) => {
    const res = await request.get('http://localhost:3002/api/schools/school-default/student-solved-rankings', {
      headers: { Authorization: `Bearer ${TEACHER_TOKEN}` }
    })
    const data = await res.json()
    expect(data.success).toBeTruthy()
    expect(data.total).toBeGreaterThan(0)
    expect(data.page).toBe(1)
    expect(data.data).toBeInstanceOf(Array)
    expect(data.data.length).toBeGreaterThan(0)

    // 第一个学生应有 solvedCount 字段
    const first = data.data[0]
    expect(first).toHaveProperty('solvedCount')
    expect(typeof first.solvedCount).toBe('number')
    expect(first).toHaveProperty('name')
    expect(first).toHaveProperty('id')
    expect(first).toHaveProperty('school')
    expect(first.school).toHaveProperty('educationSystem')
  })

  test('后端 API — 做题量降序排列', async ({ request }) => {
    const res = await request.get('http://localhost:3002/api/schools/school-default/student-solved-rankings', {
      headers: { Authorization: `Bearer ${TEACHER_TOKEN}` }
    })
    const data = await res.json()
    expect(data.success).toBeTruthy()

    const counts = data.data.map((s: any) => s.solvedCount)
    for (let i = 1; i < counts.length; i++) {
      expect(counts[i]).toBeLessThanOrEqual(counts[i - 1])
    }
  })

  test('后端 API — student-rankings 仍正常工作', async ({ request }) => {
    const res = await request.get('http://localhost:3002/api/schools/school-default/student-rankings', {
      headers: { Authorization: `Bearer ${TEACHER_TOKEN}` }
    })
    const data = await res.json()
    expect(data.success).toBeTruthy()
    expect(data.data.length).toBeGreaterThan(0)
    expect(data.data[0]).toHaveProperty('rating')
  })

  test('做题量排名 — 分页控件', async ({ page }) => {
    await setAuthToken(page, TEACHER_TOKEN, 'school_principal', TEACHER_USERID)
    await page.goto('/teacher/rankings')
    await page.waitForLoadState('networkidle')

    await page.locator('button', { hasText: '做题量' }).click()
    await page.waitForTimeout(1500)

    // 应有分页控件
    const pagination = page.locator('text=/共 \\d+ 条/')
    await expect(pagination).toBeVisible({ timeout: 5000 })
  })
})
