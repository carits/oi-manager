import { test } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'
import { installExternalMocks } from '../fixtures/external-mocks'
import { assertPageHealth, assertVisibleControlsFit, waitForPageReady, watchPage } from '../support/page-audit'

const ids = loadFixtureIds()
const organizationBase = `/org/org_${ids.school}`

type RouteCase = {
  role: AuthRole
  label: string
  path: string
}

const routeCases: RouteCase[] = [
  ...[
    ['首页', 'overview'],
    ['校园', 'campus'],
    ['管理', 'management'],
    ['团队', 'teams'],
    ['作业', 'homeworks'],
    ['比赛', 'contests'],
    ['训练', 'training-sessions'],
    ['题目', 'problems'],
    ['题单', 'problem-lists'],
    ['排名', 'rankings'],
    ['评测记录', 'submissions'],
    ['知识', 'knowledge'],
  ].map(([label, module]) => ({ role: 'principal' as const, label: `负责人 · ${label}`, path: `${organizationBase}/${module}` })),
  ...[
    ['首页', 'overview'],
    ['校园', 'campus'],
    ['管理', 'management'],
    ['团队', 'teams'],
    ['作业', 'homeworks'],
    ['比赛', 'contests'],
    ['训练', 'training-sessions'],
    ['题目', 'problems'],
    ['题单', 'problem-lists'],
    ['排名', 'rankings'],
    ['评测记录', 'submissions'],
    ['知识', 'knowledge'],
  ].map(([label, module]) => ({ role: 'teacher' as const, label: `教师 · ${label}`, path: `${organizationBase}/${module}` })),
  ...[
    ['首页', 'overview'],
    ['校园', 'campus'],
    ['团队', 'teams'],
    ['作业', 'homeworks'],
    ['比赛', 'contests'],
    ['训练', 'training-sessions'],
    ['题单', 'problem-lists'],
    ['排名', 'rankings'],
    ['评测记录', 'submissions'],
    ['知识', 'knowledge'],
  ].map(([label, module]) => ({ role: 'campusStudent' as const, label: `学生 · ${label}`, path: `${organizationBase}/${module}` })),

  { role: 'principal', label: '负责人 · 团队详情', path: `${organizationBase}/teams/${ids.team}` },
  { role: 'principal', label: '负责人 · 作业详情', path: `${organizationBase}/homeworks/${ids.homework}` },
  { role: 'principal', label: '负责人 · 比赛详情', path: `${organizationBase}/contests/${ids.contest}` },
  { role: 'principal', label: '负责人 · 训练工作台', path: `${organizationBase}/training-sessions/${ids.trainingSession}` },
  { role: 'principal', label: '负责人 · 训练设计器', path: `${organizationBase}/training-sessions/${ids.trainingSession}/design` },
  { role: 'principal', label: '负责人 · 题目详情', path: `${organizationBase}/problems/${ids.problem}` },
  { role: 'principal', label: '负责人 · 题目编辑', path: `${organizationBase}/problems/${ids.problem}/edit` },
  { role: 'principal', label: '负责人 · 题目笔记', path: `${organizationBase}/problems/${ids.problem}/note` },
  { role: 'principal', label: '负责人 · 题单详情', path: `${organizationBase}/problem-lists/${ids.problemList}` },
  { role: 'principal', label: '负责人 · 提交详情', path: `${organizationBase}/submissions/${ids.submission}` },

  { role: 'campusStudent', label: '学生 · 团队详情', path: `${organizationBase}/teams/${ids.team}` },
  { role: 'campusStudent', label: '学生 · 作业详情', path: `${organizationBase}/homeworks/${ids.homework}` },
  { role: 'campusStudent', label: '学生 · 比赛详情', path: `${organizationBase}/contests/${ids.contest}` },
  { role: 'campusStudent', label: '学生 · 训练工作台', path: `${organizationBase}/training-sessions/${ids.trainingSession}` },
  { role: 'campusStudent', label: '学生 · 题单详情', path: `${organizationBase}/problem-lists/${ids.problemList}` },
  { role: 'campusStudent', label: '学生 · 提交详情', path: `${organizationBase}/submissions/${ids.submission}` },
]

test.describe('organization dynamic route expansion @smoke @compact', () => {
  for (const entry of routeCases) {
    test(`${entry.label} renders as a concrete route`, async ({ browser }) => {
      const context = await browser.newContext({
        storageState: accounts[entry.role].storageState,
        viewport: { width: 1024, height: 768 },
      })
      const page = await context.newPage()
      const audit = watchPage(page)
      await installExternalMocks(page)
      await page.goto(entry.path, { waitUntil: 'domcontentloaded' })
      await waitForPageReady(page)
      await assertPageHealth(page, audit, { checkAccessibility: false })
      await assertVisibleControlsFit(page)
      await context.close()
    })
  }
})
