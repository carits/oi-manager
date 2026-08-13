#!/usr/bin/env node

// 赛时演示 V3 只调用受鉴权 HTTP API；不导入 Prisma、不连接数据库、不执行 SQL。
const base = process.env.DEMO_API_BASE || 'http://127.0.0.1:3002/api'
const teacherName = process.env.DEMO_TEACHER_USERNAME
const teacherPassword = process.env.DEMO_TEACHER_PASSWORD
const adminName = process.env.DEMO_PLATFORM_ADMIN_USERNAME
const adminPassword = process.env.DEMO_PLATFORM_ADMIN_PASSWORD
const scenarioKey = process.env.DEMO_SCENARIO_KEY
const studentPassword = process.env.DEMO_STUDENT_PASSWORD || '123456'

for (const key of ['DEMO_TEACHER_USERNAME', 'DEMO_TEACHER_PASSWORD', 'DEMO_PLATFORM_ADMIN_USERNAME', 'DEMO_PLATFORM_ADMIN_PASSWORD', 'DEMO_SCENARIO_KEY']) {
  if (!process.env[key]) throw new Error('缺少环境变量：' + key)
}

async function request(path, options = {}) {
  const headers = { ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}), ...(options.headers || {}) }
  let body = options.form
  if (options.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(options.body) }
  const response = await fetch(base + path, { method: options.method || 'GET', headers, body })
  const data = await response.json().catch(() => ({ success: false, message: 'HTTP ' + response.status }))
  if (!response.ok || !data.success) throw new Error((options.method || 'GET') + ' ' + path + '：' + (data.message || response.status))
  return data.data
}
function list(value) { return Array.isArray(value) ? value : value?.items || value?.students || value?.problems || value?.submissions || [] }
function upload(files, description) {
  const data = new FormData()
  for (const file of files) data.append(file.field || 'files', new Blob([file.content], { type: 'text/plain' }), file.name)
  if (description) data.append('description', description)
  return data
}
async function login(username, password) {
  if (login.count > 0) await new Promise(resolve => setTimeout(resolve, 13000))
  login.count += 1
  return (await request('/auth/login', { method: 'POST', body: { username, password } })).token
}
login.count = 0

const students = Array.from({ length: 8 }, (_, index) => ({
  username: 'live_v3_' + String(index + 1).padStart(2, '0'),
  name: '赛时演示同学' + (index + 1),
  gender: index % 2 ? '女' : '男',
}))

const tasks = [
  { key: 'A', title: '赛时演示 V3 A：带符号两数之和', desc: '输入两个整数，输出它们的和。', solution: '直接使用 long long 计算 a+b；负数也是合法输入。', tests: [['3 5\n','8\n'], ['-7 4\n','-3\n']], scores: [30, 70] },
  { key: 'B', title: '赛时演示 V3 B：三个数的最大值', desc: '输入三个整数，输出其中最大的数。', solution: '比较三个数即可，不能假设输入非负。', tests: [['4 9 2\n','9\n'], ['-8 -3 -11\n','-3\n']], scores: [40, 60] },
  { key: 'C', title: '赛时演示 V3 C：整数奇偶', desc: '输入整数 n。偶数输出 even，否则输出 odd。', solution: '使用 n%2 判断，负奇数同样输出 odd。', tests: [['8\n','even\n'], ['-5\n','odd\n']], scores: [50, 50] },
  { key: 'D', title: '赛时演示 V3 D：一到 N 的和', desc: '输入正整数 n，输出 1 到 n 的和。', solution: '使用 64 位整数计算 n*(n+1)/2。', tests: [['100\n','5050\n'], ['100000\n','5000050000\n']], scores: [30, 70] },
  { key: 'E', title: '赛时演示 V3 E：元音计数', desc: '输入一个英文单词，统计 a、e、i、o、u 的数量，大小写均计入。', solution: '遍历字符并统一转小写后判断。', tests: [['code\n','2\n'], ['AEIOU\n','5\n']], scores: [35, 65] },
  { key: 'F', title: '赛时演示 V3 F：两数距离', desc: '输入两个整数，输出它们差的绝对值。', solution: '使用 llabs 或手动取绝对值，注意负数。', tests: [['3 10\n','7\n'], ['-4 5\n','9\n']], scores: [45, 55] },
  { key: 'G', title: '赛时演示 V3 G：偶数个数', desc: '输入 n 和 n 个整数，输出其中偶数的个数。', solution: '逐个读取并统计 x%2==0。', tests: [['5\n1 2 3 4 5\n','2\n'], ['4\n-2 -1 0 7\n','2\n']], scores: [40, 60] },
  { key: 'H', title: '赛时演示 V3 H：反转字符串', desc: '输入一个不含空格的字符串，输出它的反转结果。', solution: '可调用 reverse，也可双指针交换。大小写必须保留。', tests: [['carits\n','stirac\n'], ['AbC\n','CbA\n']], scores: [50, 50] },
]

function judgeConfig(task) {
  return {
    subtasks: task.scores.map((score, index) => ({
      id: 'subtask-' + (index + 1),
      score,
      type: 'min',
      cases: [{ input: (index + 1) + '.in', output: (index + 1) + '.out', score }],
    })),
  }
}

async function ensureStudents(teacherToken) {
  const current = list(await request('/students?page=1&pageSize=100', { token: teacherToken }))
  const result = []
  for (const spec of students) {
    let student = current.find(item => item.user?.username === spec.username)
    if (!student) student = await request('/students', { token: teacherToken, method: 'POST', body: { ...spec, enrollmentYear: 2025, targetContest: 'CSP-S' } })
    await request('/students/' + student.id, { token: teacherToken, method: 'PUT', body: { password: studentPassword } })
    result.push({ ...spec, id: student.id })
  }
  return result
}

async function ensureTeam(teacherToken) {
  const teams = list(await request('/teams?view=mine&page=1&pageSize=100', { token: teacherToken }))
  const existing = teams.find(item => item.id === 'live_contest_v3_team')
  return existing || request('/teams', { token: teacherToken, method: 'POST', body: {
    id: 'live_contest_v3_team',
    name: '赛时演示 V3 队',
    description: '20 小时进行中的 OI、IOI、ICPC 复杂赛时数据。',
    isPublic: false,
  } })
}

async function ensureMembers(teacherToken, team, members) {
  const detail = await request('/teams/' + team.id, { token: teacherToken })
  const active = new Set((detail.members || []).filter(item => item.status === 'active').map(item => item.userId))
  const usernames = members.filter(member => !active.has(member.id)).map(member => member.username)
  if (usernames.length) await request('/teams/' + team.id + '/members', { token: teacherToken, method: 'POST', body: { usernames, role: 'member' } })
  for (const member of members) {
    const token = await login(member.username, studentPassword)
    const invitations = list(await request('/teams/invitations', { token }))
    const invitation = invitations.find(item => item.teamId === team.id)
    if (invitation) await request('/teams/invitations/' + invitation.id + '/accept', { token, method: 'POST' })
  }
}

async function ensureProblems(teacherToken) {
  const current = list(await request('/problems?library=school&page=1&pageSize=100', { token: teacherToken }))
  const result = []
  for (const task of tasks) {
    let problem = current.find(item => item.title === task.title)
    if (!problem) {
      problem = await request('/problems', { token: teacherToken, method: 'POST', body: {
        title: task.title,
        description: task.desc + '\n\n样例、题解与测试数据说明见附件。',
        statementType: 'markdown',
        solutionType: 'markdown',
        solutionMarkdown: '## 思路\n\n' + task.solution,
        solutionVisible: true,
        difficulty: '入门',
        timeLimit: 1000,
        memoryLimit: 256,
        status: 'published',
      } })
      const files = task.tests.flatMap((test, index) => [
        { name: (index + 1) + '.in', content: test[0] },
        { name: (index + 1) + '.out', content: test[1] },
      ])
      await request('/problems/' + problem.id + '/attachments', { token: teacherToken, method: 'POST', form: upload([{ field: 'file', name: '样例说明.md', content: '# 样例解释\n\n' + task.desc + '\n\n' + task.solution + '\n' }], '样例解释') })
      await request('/problems/' + problem.id + '/testdata', { token: teacherToken, method: 'POST', form: upload(files) })
      await request('/problems/' + problem.id + '/judge-config', { token: teacherToken, method: 'PUT', body: { problemType: 'standard', timeLimit: 1000, memoryLimit: 256, config: judgeConfig(task) } })
    }
    result.push({ ...task, id: problem.id })
  }
  return result
}

async function ensureContests(teacherToken, team, problems) {
  const current = list(await request('/teams/' + team.id + '/trainings?type=contest', { token: teacherToken }))
  const now = Date.now()
  const result = []
  for (const format of ['oi', 'ioi', 'icpc']) {
    const title = '赛时演示 V3 ' + format.toUpperCase() + ' 20 小时赛'
    let contest = current.find(item => item.title === title)
    if (!contest) {
      contest = await request('/teams/' + team.id + '/trainings', { token: teacherToken, method: 'POST', body: {
        title,
        description: '赛时演示 V3：8 题、8 人、复杂提交时间线，覆盖 AC、WA、部分分与赛制可见性。',
        format,
        type: 'contest',
        startTime: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(now + 48 * 60 * 60 * 1000).toISOString(),
        problemIdVisible: true,
        solutionVisible: true,
      } })
      for (const [index, problem] of problems.entries()) {
        await request('/trainings/' + contest.id + '/problems', { token: teacherToken, method: 'POST', body: { problemId: problem.id, alias: String.fromCharCode(65 + index), points: 100 } })
      }
    }
    result.push(await request('/trainings/' + contest.id, { token: teacherToken }))
  }
  return result
}

async function waitForJudge(teacherToken, contests) {
  const deadline = Date.now() + 20 * 60 * 1000
  while (Date.now() < deadline) {
    const states = await Promise.all(contests.map(async contest => {
      const payload = await request('/trainings/' + contest.id + '/submissions?page=1&pageSize=500', { token: teacherToken })
      return list(payload.submissions || payload).some(item => item.result === 'queuing' || item.result === 'judging')
    }))
    if (!states.some(Boolean)) return
    await new Promise(resolve => setTimeout(resolve, 4000))
  }
  throw new Error('等待评测超时')
}

async function main() {
  const teacherToken = await login(teacherName, teacherPassword)
  const adminToken = await login(adminName, adminPassword)
  const members = await ensureStudents(teacherToken)
  const team = await ensureTeam(teacherToken)
  await ensureMembers(teacherToken, team, members)
  const problems = await ensureProblems(teacherToken)
  const contests = await ensureContests(teacherToken, team, problems)
  const headers = { 'x-demo-scenario-key': scenarioKey }
  const prepare = await request('/admin/demo-scenario/v3/prepare', { token: adminToken, method: 'POST', headers })
  const events = await request('/admin/demo-scenario/v3/events', { token: adminToken, method: 'POST', headers })
  await waitForJudge(teacherToken, contests)
  console.log(JSON.stringify({ success: true, prepare, events, students: members.map(item => item.username), contests: contests.map(item => ({ id: item.id, title: item.title })) }, null, 2))
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
