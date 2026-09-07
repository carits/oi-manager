import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const serverRequire = createRequire(new URL('../apps/server/package.json', import.meta.url))
const rootRequire = createRequire(new URL('../package.json', import.meta.url))
const { PrismaClient } = serverRequire('@prisma/client')
const dotenv = serverRequire('dotenv')
const jwt = serverRequire('jsonwebtoken')
const { chromium } = rootRequire('@playwright/test')

dotenv.config({ path: fileURLToPath(new URL('../apps/server/.env', import.meta.url)) })

const problemId = process.env.JUDGE_TEMPLATE_PROBE_PROBLEM_ID || 'a53632ff-0ef4-4afb-ba18-af4af4a8b415'
const baseUrl = process.env.JUDGE_TEMPLATE_PROBE_BASE_URL || 'http://127.0.0.1:3000'
const prisma = new PrismaClient()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function activeProgramIdentity() {
  return prisma.problemJudgeProgram.findMany({
    where: { problemId, kind: { in: ['standard', 'validator'] }, currentVersionId: { not: null } },
    orderBy: [{ kind: 'asc' }, { id: 'asc' }],
    select: { id: true, kind: true, currentVersionId: true },
  })
}

async function verifyViewport(browser, token, viewport) {
  const context = await browser.newContext({ viewport })
  await context.addCookies([{ name: 'oi_session', value: token, url: baseUrl, httpOnly: true, sameSite: 'Lax' }])
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.goto(`${baseUrl}/platform-admin/problems/${problemId}/edit`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: '评测设置', exact: true }).click()
    await page.getByRole('button', { name: '评测资产与生成', exact: true }).click()
    await page.getByRole('heading', { name: '内置模板与完整示例' }).waitFor()
    for (const label of ['标准程序 STD 示例', '输入校验器 Validator 示例', '子任务分类器 Classifier 示例', '数据生成器 Generator 示例']) {
      assert(await page.getByRole('tab', { name: label }).count() === 1, `缺少模板入口：${label}`)
    }
    await page.getByRole('tab', { name: '子任务分类器 Classifier 示例' }).click()
    const card = page.locator('article').filter({ hasText: 'C++17 子任务分类器' }).first()
    await card.getByRole('button', { name: '查看完整示例' }).click()
    const dialog = page.getByRole('dialog', { name: /C\+\+17 子任务分类器 · 完整示例/ })
    await dialog.waitFor()
    assert(await dialog.getByText('当前题目 Subtask：1（100 分）', { exact: true }).count() === 1, 'P1345 Subtask 摘要不正确')
    assert(await dialog.getByText(/不存在的 Subtask：2, 3/).count() === 1, 'Classifier 未显示未知 Subtask 阻断')
    assert(await dialog.getByText(/"subtasks"/).count() > 0, 'Classifier 完整 JSON 输出示例不可见')
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)
    assert(!overflow, `${viewport.width}×${viewport.height} 页面产生横向溢出`)
    assert(errors.length === 0, `浏览器错误：${errors.join('; ')}`)
    return { viewport: `${viewport.width}x${viewport.height}`, classifierExampleVisible: true, subtaskSummary: '1 (100)' }
  } finally {
    await context.close()
  }
}

let browser
try {
  assert(process.env.JWT_SECRET, 'JWT_SECRET 未配置')
  const [problem, manager, before] = await Promise.all([
    prisma.problem.findUnique({ where: { id: problemId }, select: { platform: true, problemId: true, title: true } }),
    prisma.user.findFirst({ where: { role: 'platform_admin', status: 'active' }, orderBy: { createdAt: 'asc' }, select: { id: true, username: true, role: true } }),
    activeProgramIdentity(),
  ])
  assert(problem, '线上验收题目不存在')
  assert(problem.platform === 'luogu' && problem.problemId === 'P1345', '验收目标不是洛谷 P1345')
  assert(manager, '没有可用的平台管理员探针身份')
  const token = jwt.sign({ userId: manager.id, username: manager.username, role: manager.role, workspaceMode: 'work' }, process.env.JWT_SECRET, { expiresIn: '5m' })
  browser = await chromium.launch({ headless: true })
  const views = []
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) views.push(await verifyViewport(browser, token, viewport))
  const after = await activeProgramIdentity()
  assert(JSON.stringify(after) === JSON.stringify(before), '只读模板探针意外改变了 P1345 活动 STD/Validator')
  console.log(JSON.stringify({ problem: `${problem.platform}:${problem.problemId}`, title: problem.title, activeProgramsUnchanged: true, views }))
} finally {
  await browser?.close()
  await prisma.$disconnect()
}
