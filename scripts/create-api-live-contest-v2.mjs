#!/usr/bin/env node

// This script talks only to authenticated HTTP APIs. It never imports Prisma or SQL clients.
const base = process.env.DEMO_API_BASE || 'http://127.0.0.1:3002/api'
const teacherName = process.env.DEMO_TEACHER_USERNAME
const teacherPassword = process.env.DEMO_TEACHER_PASSWORD
const studentPassword = process.env.DEMO_STUDENT_PASSWORD
const adminName = process.env.DEMO_PLATFORM_ADMIN_USERNAME
const adminPassword = process.env.DEMO_PLATFORM_ADMIN_PASSWORD
const scenarioKey = process.env.DEMO_SCENARIO_KEY

for (const name of ['DEMO_TEACHER_USERNAME', 'DEMO_TEACHER_PASSWORD', 'DEMO_STUDENT_PASSWORD', 'DEMO_PLATFORM_ADMIN_USERNAME', 'DEMO_PLATFORM_ADMIN_PASSWORD', 'DEMO_SCENARIO_KEY']) {
  if (!process.env[name]) throw new Error('Missing environment variable: ' + name)
}

async function request(path, options = {}) {
  const headers = { ...(options.session ? { Cookie: options.session } : {}), ...(options.headers || {}) }
  let body = options.form
  if (options.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(options.body) }
  const response = await fetch(base + path, { method: options.method || 'GET', headers, body })
  const json = await response.json().catch(() => ({ success: false, message: 'HTTP ' + response.status }))
  if (!response.ok || !json.success) throw new Error((options.method || 'GET') + ' ' + path + ': ' + (json.message || response.status))
  if (path === '/auth/login') return { ...json.data, session: response.headers.get('set-cookie')?.split(';')[0] }
  return json.data
}

async function login(username, password, role) {
  return (await request('/auth/login', { method: 'POST', body: { username, password, workspaceMode: 'work' } })).session
}
let loginCount = 0
async function throttledLogin(username, password, role) {
  if (loginCount > 0) await new Promise(resolve => setTimeout(resolve, 13000))
  loginCount += 1
  return login(username, password, role)
}
function list(value) { return Array.isArray(value) ? value : value?.items || value?.data || value?.students || value?.problems || value?.submissions || [] }
function form(files, description) {
  const data = new FormData()
  for (const file of files) data.append(file.field || 'files', new Blob([file.content], { type: 'text/plain' }), file.name)
  if (description) data.append('description', description)
  return data
}
const students = Array.from({ length: 5 }, (_, index) => ({ username: 'live_v2_0' + (index + 1), name: '赛时演示同学' + (index + 1), gender: index % 2 ? '女' : '男' }))
const tasks = [
  { key: 'A', title: '赛时演示 V2 A：带符号两数之和', desc: '输入两个整数，输出它们的和。', solution: '直接计算 a+b。第二组包含负数，用于验证边界。', tests: [['1.in','3 5\n','1.out','8\n'],['2.in','-7 4\n','2.out','-3\n']], scores: [30,70] },
  { key: 'B', title: '赛时演示 V2 B：三个数的最大值', desc: '输入三个整数，输出其中最大的数。', solution: '使用 max 比较三个数。第二组均为负数。', tests: [['1.in','4 9 2\n','1.out','9\n'],['2.in','-8 -3 -11\n','2.out','-3\n']], scores: [40,60] },
  { key: 'C', title: '赛时演示 V2 C：整数奇偶', desc: '输入整数 n。偶数输出 even，否则输出 odd。', solution: 'n%2 是否为 0 即可判断。负数也必须正确处理。', tests: [['1.in','7\n','1.out','odd\n'],['2.in','8\n','2.out','even\n'],['3.in','-5\n','3.out','odd\n']], scores: [20,30,50] },
  { key: 'D', title: '赛时演示 V2 D：一到 N 的和', desc: '输入正整数 n，输出 1 到 n 的和。', solution: '使用 64 位整数计算 n*(n+1)/2。', tests: [['1.in','100\n','1.out','5050\n'],['2.in','100000\n','2.out','5000050000\n']], scores: [30,70] },
  { key: 'E', title: '赛时演示 V2 E：元音计数', desc: '输入一个不含空格的英文单词，统计 a e i o u 的数量，大小写均计入。', solution: '遍历字符并转为小写后判断是否为元音。', tests: [['1.in','code\n','1.out','2\n'],['2.in','AEIOU\n','2.out','5\n']], scores: [30,70] },
]
const contests = ['oi', 'ioi', 'icpc'].flatMap(format => ['进行中', '已结束', '未开始'].map(state => ({ format, state, title: '赛时演示 V2 ' + format.toUpperCase() + ' 校队赛 - ' + state })))

async function ensureStudents(teacherSession) {
  const current = list(await request('/students?page=1&pageSize=100', { session: teacherSession }))
  const output = []
  for (const spec of students) {
    let student = current.find(item => item.user?.username === spec.username)
    if (!student) student = await request('/students', { session: teacherSession, method: 'POST', body: { ...spec, enrollmentYear: 2025, targetContest: 'CSP-S' } })
    await request('/students/' + student.id, { session: teacherSession, method: 'PUT', body: { password: studentPassword } })
    output.push({ ...spec, id: student.id })
  }
  for (const student of output) student.session = await throttledLogin(student.username, studentPassword, 'student')
  return output
}
async function ensureCampusMemberships(teacherSession, members) {
  const workspaces = (await request('/workspaces', { session: teacherSession })).workspaces || []
  const campus = workspaces.find(item => item.type === 'organization' && item.memberRole === 'school_principal')
  if (!campus) throw new Error('当前教师没有可邀请学生进入的校园身份')

  for (const student of members) {
    const studentWorkspaces = (await request('/workspaces', { session: student.session })).workspaces || []
    if (studentWorkspaces.some(item => item.type === 'organization' && item.organizationId === campus.organizationId)) continue
    const invitation = await request('/organizations/' + campus.organizationId + '/invitations', {
      token: teacherSession,
      method: 'POST',
      body: { username: student.username, memberRole: 'student' }
    })
    await request('/organization-invitations/' + invitation.id + '/accept', { session: student.session, method: 'POST' })
  }
}
async function ensureTeam(teacherSession) {
  const current = list(await request('/teams?view=mine&page=1&pageSize=100', { session: teacherSession }))
  return current.find(item => item.id === 'live_contest_v2_team') || request('/teams', { session: teacherSession, method: 'POST', body: { id: 'live_contest_v2_team', name: '赛时演示 V2 队', description: '用于验证 OI、IOI、ICPC 的赛时可见性和真实评测时间线。', isPublic: false } })
}
async function ensureMembers(teacherSession, team, members) {
  const detail = await request('/teams/' + team.id, { session: teacherSession })
  const ids = new Set((detail.members || []).filter(member => member.status === 'active').map(member => member.userId))
  const usernames = members.filter(member => !ids.has(member.id)).map(member => member.username)
  if (usernames.length) await request('/teams/' + team.id + '/members', { session: teacherSession, method: 'POST', body: { usernames, role: 'member' } })
  for (const student of members) {
    const invitations = list(await request('/teams/invitations', { session: student.session }))
    const invitation = invitations.find(item => item.teamId === team.id)
    if (invitation) await request('/teams/invitations/' + invitation.id + '/accept', { session: student.session, method: 'POST' })
  }
}
function configFor(task) {
  return { subtasks: task.scores.map((score, index) => ({ id: 'subtask-' + (index + 1), score, type: 'min', cases: [{ input: (index + 1) + '.in', output: (index + 1) + '.out', score }] })) }
}
async function ensureProblems(teacherSession) {
  const current = list(await request('/problems?library=school&page=1&pageSize=100', { session: teacherSession }))
  const output = []
  for (const task of tasks) {
    let problem = current.find(item => item.title === task.title)
    if (!problem) {
      problem = await request('/problems', { session: teacherSession, method: 'POST', body: { title: task.title, description: task.desc + '\n\n样例输入输出见附件。', statementType: 'markdown', solutionType: 'markdown', solutionMarkdown: task.solution, solutionVisible: true, difficulty: '入门', timeLimit: 1000, memoryLimit: 256, status: 'published' } })
      const files = task.tests.flatMap(row => [{ name: row[0], content: row[1] }, { name: row[2], content: row[3] }])
      await request('/problems/' + problem.id + '/attachments', { session: teacherSession, method: 'POST', form: form([{ field: 'file', name: '样例说明.md', content: '# 样例说明\n\n' + task.desc + '\n\n' + task.solution + '\n' }], '样例解释') })
      await request('/problems/' + problem.id + '/testdata', { session: teacherSession, method: 'POST', form: form(files) })
      await request('/problems/' + problem.id + '/judge-config', { session: teacherSession, method: 'PUT', body: { problemType: 'standard', timeLimit: 1000, memoryLimit: 256, config: configFor(task) } })
    }
    output.push({ ...task, id: problem.id })
  }
  return output
}
async function ensureContests(teacherSession, team, problems) {
  const current = list(await request('/teams/' + team.id + '/trainings?type=contest', { session: teacherSession })); const output=[]; const now=Date.now()
  for (const spec of contests) {
    let contest=current.find(item=>item.title===spec.title)
    if (!contest) {
      contest=await request('/teams/'+team.id+'/trainings',{token:teacherSession,method:'POST',body:{title:spec.title,description:'赛时演示 V2：真实评测、部分分、错误提交和固定时间线。',format:spec.format,type:'contest',startTime:new Date(now+86400000).toISOString(),endTime:new Date(now+259200000).toISOString(),problemIdVisible:true,solutionVisible:true}})
      for (const [index,problem] of problems.entries()) await request('/trainings/'+contest.id+'/problems',{token:teacherSession,method:'POST',body:{problemId:problem.id,alias:String.fromCharCode(65+index),points:100}})
    }
    output.push({ ...spec, ...(await request('/trainings/'+contest.id,{token:teacherSession})) })
  }
  return output
}
async function waitForJudge(teacherSession, contests) {
  const deadline=Date.now()+720000
  while (Date.now()<deadline) {
    const pending=await Promise.all(contests.map(async contest=>list((await request('/trainings/'+contest.id+'/submissions?page=1&pageSize=200',{token:teacherSession})).submissions).some(item=>item.result==='queuing'||item.result==='judging')))
    if (!pending.some(Boolean)) return
    await new Promise(resolve=>setTimeout(resolve,3000))
  }
  throw new Error('Timed out waiting for judge')
}
async function main() {
  const teacherSession=await throttledLogin(teacherName,teacherPassword,'teacher')
  const adminSession=await throttledLogin(adminName,adminPassword,'admin')
  const team=await ensureTeam(teacherSession); const members=await ensureStudents(teacherSession)
  await ensureCampusMemberships(teacherSession,members)
  await ensureMembers(teacherSession,team,members); const problems=await ensureProblems(teacherSession); const all=await ensureContests(teacherSession,team,problems)
  const headers={'x-demo-scenario-key':scenarioKey}
  await request('/admin/demo-scenario/v2/prepare',{token:adminSession,method:'POST',headers})
  const events=await request('/admin/demo-scenario/v2/events',{token:adminSession,method:'POST',headers})
  const active=all.filter(contest=>contest.state!=='未开始')
  await waitForJudge(teacherSession,active)
  for (const contest of all.filter(contest=>contest.state==='已结束')) await request('/trainings/'+contest.id+'/finish',{token:teacherSession,method:'POST'})
  console.log(JSON.stringify({success:true,teamId:team.id,events,users:members.map(member=>member.username),contests:all.map(contest=>({id:contest.id,title:contest.title,state:contest.state}))},null,2))
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1})
