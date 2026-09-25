#!/usr/bin/env node

// 仅通过受鉴权 API 创建演示比赛数据。禁止导入 Prisma、连接数据库或执行 SQL。
const base = process.env.DEMO_API_BASE || 'http://127.0.0.1:3002/api'
const teacherName = process.env.DEMO_TEACHER_USERNAME
const teacherPassword = process.env.DEMO_TEACHER_PASSWORD
const studentPassword = process.env.DEMO_STUDENT_PASSWORD

for (const key of ['DEMO_TEACHER_USERNAME', 'DEMO_TEACHER_PASSWORD', 'DEMO_STUDENT_PASSWORD']) {
  if (!process.env[key]) throw new Error('缺少环境变量：' + key)
}

async function request(path, options = {}) {
  const headers = options.session ? { Cookie: options.session } : {}
  let body
  if (options.form) body = options.form
  else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(options.body)
  }
  const response = await fetch(base + path, { method: options.method || 'GET', headers, body })
  const json = await response.json().catch(() => ({ success: false, message: 'HTTP ' + response.status }))
  if (!response.ok || !json.success) throw new Error((options.method || 'GET') + ' ' + path + '：' + (json.message || response.status))
  if (path === '/auth/login') return { ...json.data, session: response.headers.get('set-cookie')?.split(';')[0] }
  return json.data
}

async function login(username, password, role) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: { username, password, workspaceMode: 'work' },
  })
  return data.session
}

let loginCount = 0
async function throttledLogin(username, password, role) {
  // 登录接口每分钟最多 5 次：教师登录后可连续登录 4 名学生。
  if (loginCount === 5) {
    await new Promise(resolve => setTimeout(resolve, 61000))
    loginCount = 0
  }
  const session = await login(username, password, role)
  loginCount += 1
  return session
}

function items(data) {
  if (Array.isArray(data)) return data
  return data?.items || data?.data || data?.students || data?.problems || data?.submissions || []
}

function makeForm(files, description) {
  const form = new FormData()
  for (const file of files) form.append(file.field || 'files', new Blob([file.content], { type: file.type || 'text/plain' }), file.name)
  if (description) form.append('description', description)
  return form
}

const studentSpecs = Array.from({ length: 5 }, (_, index) => ({
  username: 'demo_contest_' + String(index + 1).padStart(2, '0'),
  name: '演示竞赛用户' + (index + 1),
  gender: index % 2 ? '女' : '男',
}))

const problemSpecs = [
  ['两数之和', '给定两个整数 a、b，输出它们的和。', '3 5\n', '8\n', '直接输出 a+b，时间复杂度 O(1)。'],
  ['三个数的最大值', '给定三个整数，输出其中最大的一个。', '4 9 2\n', '9\n', '使用 max 比较三个数，时间复杂度 O(1)。'],
  ['奇偶判断', '给定一个整数 n。偶数输出 even，否则输出 odd。', '7\n', 'odd\n', '判断 n%2 是否为 0，时间复杂度 O(1)。'],
  ['一到N的和', '给定正整数 n，输出 1 到 n 的所有整数之和。', '5\n', '15\n', '使用公式 n*(n+1)/2，并使用 64 位整数。'],
  ['元音字母计数', '给定字符串，统计 a、e、i、o、u 的数量。', 'Code\n', '2\n', '遍历字符串，转小写后判断是否为元音字母。'],
].map((row, index) => ({
  key: String.fromCharCode(65 + index),
  title: '演示题目 ' + String.fromCharCode(65 + index) + '：' + row[0],
  description: row[1] + '\n\n样例输入：' + row[2].trim() + '\n样例输出：' + row[3].trim(),
  input: row[2],
  output: row[3],
  solution: row[4],
}))

const contests = ['oi', 'ioi', 'icpc'].flatMap(format => ['进行中', '已结束', '未开始'].map(state => ({
  format,
  state,
  title: '演示 ' + format.toUpperCase() + ' 校队赛 - ' + state,
})))

const sources = [
  '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b;if(cin>>a>>b)cout<<a+b<<"\\n";}\n',
  '#include <bits/stdc++.h>\nusing namespace std;int main(){long long a,b,c;if(cin>>a>>b>>c)cout<<max(a,max(b,c))<<"\\n";}\n',
  '#include <bits/stdc++.h>\nusing namespace std;int main(){long long n;if(cin>>n)cout<<(n%2?"odd":"even")<<"\\n";}\n',
  '#include <bits/stdc++.h>\nusing namespace std;int main(){long long n;if(cin>>n)cout<<n*(n+1)/2<<"\\n";}\n',
  '#include <bits/stdc++.h>\nusing namespace std;int main(){string s;if(cin>>s){int a=0;for(char c:s){c=tolower((unsigned char)c);if(string("aeiou").find(c)!=string::npos)++a;}cout<<a<<"\\n";}}\n',
]

async function ensureStudents(teacherSession) {
  const current = items(await request('/students?page=1&pageSize=100', { session: teacherSession }))
  const result = []
  for (const spec of studentSpecs) {
    let student = current.find(item => item.user?.username === spec.username)
    if (!student) {
      student = await request('/students', {
        token: teacherSession,
        method: 'POST',
        body: { ...spec, enrollmentYear: 2025, targetContest: 'CSP-S' },
      })
    }
    await request('/students/' + student.id, { session: teacherSession, method: 'PUT', body: { password: studentPassword } })
    result.push({ ...spec, id: student.id, session: await throttledLogin(spec.username, studentPassword, 'student') })
  }
  return result
}

async function ensureTeam(teacherSession) {
  const current = items(await request('/teams?view=mine&page=1&pageSize=100', { session: teacherSession }))
  let team = current.find(item => item.id === 'demo_contest_team')
  if (!team) {
    team = await request('/teams', {
      token: teacherSession,
      method: 'POST',
      body: { id: 'demo_contest_team', name: '演示竞赛训练队', description: '展示三种赛制比赛、提交、题解附件和排名。', isPublic: false },
    })
  }
  return team
}

async function ensureMembers(teacherSession, team, students) {
  const detail = await request('/teams/' + team.id, { session: teacherSession })
  const activeIds = new Set((detail.members || []).filter(member => member.status === 'active').map(member => member.userId))
  const invitees = students.filter(student => !activeIds.has(student.id)).map(student => student.username)
  if (invitees.length) {
    await request('/teams/' + team.id + '/members', {
      token: teacherSession,
      method: 'POST',
      body: { usernames: invitees, role: 'member' },
    })
  }
  for (const student of students) {
    const invitations = items(await request('/teams/invitations', { session: student.session }))
    const invitation = invitations.find(item => item.teamId === team.id)
    if (invitation) await request('/teams/invitations/' + invitation.id + '/accept', { session: student.session, method: 'POST' })
  }
}

async function ensureProblems(teacherSession) {
  const current = items(await request('/problems?library=school&page=1&pageSize=100', { session: teacherSession }))
  const result = []
  for (const spec of problemSpecs) {
    let problem = current.find(item => item.title === spec.title)
    if (!problem) {
      problem = await request('/problems', {
        token: teacherSession,
        method: 'POST',
        body: {
          title: spec.title,
          description: spec.description,
          statementType: 'markdown',
          solutionType: 'markdown',
          solutionMarkdown: spec.solution,
          solutionVisible: true,
          difficulty: '入门',
          timeLimit: 1000,
          memoryLimit: 256,
          status: 'published',
        },
      })
      await request('/problems/' + problem.id + '/attachments', {
        token: teacherSession,
        method: 'POST',
        form: makeForm([{ field: 'file', name: '样例说明.md', content: '# 样例解释\n' + spec.description + '\n' }], '样例输入输出与解题说明'),
      })
      await request('/problems/' + problem.id + '/testdata', {
        token: teacherSession,
        method: 'POST',
        form: makeForm([
          { name: '1.in', content: spec.input },
          { name: '1.out', content: spec.output },
          { name: '2.in', content: spec.input },
          { name: '2.out', content: spec.output },
        ]),
      })
    }
    result.push({ ...spec, id: problem.id })
  }
  return result
}

async function ensureContests(teacherSession, team, problems) {
  const current = items(await request('/teams/' + team.id + '/contests?type=contest', { session: teacherSession }))
  const now = Date.now()
  const result = []
  for (const spec of contests) {
    let contest = current.find(item => item.title === spec.title)
    if (!contest) {
      contest = await request('/teams/' + team.id + '/contests', {
        token: teacherSession,
        method: 'POST',
        body: {
          title: spec.title,
          description: '演示比赛列表、评测记录、题解附件和排名矩阵。',
          format: spec.format,
          type: 'contest',
          startTime: new Date(now + 86400000).toISOString(),
          endTime: new Date(now + 259200000).toISOString(),
          problemIdVisible: true,
          solutionVisible: true,
        },
      })
      for (const [index, problem] of problems.entries()) {
        await request('/trainings/' + contest.id + '/problems', {
          token: teacherSession,
          method: 'POST',
          body: { problemId: problem.id, alias: String.fromCharCode(65 + index), points: 100 },
        })
      }
    }
    result.push({ ...spec, ...(await request('/trainings/' + contest.id, { session: teacherSession })) })
  }
  return result
}

async function createSubmissions(teacherSession, contest, students) {
  await request('/trainings/' + contest.id + '/start', { session: teacherSession, method: 'POST' })
  const old = await request('/trainings/' + contest.id + '/submissions?page=1&pageSize=200', { session: teacherSession }).catch(() => null)
  const previous = items(old)
  const existing = new Set(previous.map(item => item.userId + ':' + item.trainingProblemId))
  const wrongExisting = new Set(previous.filter(item => item.result !== 'accepted').map(item => item.userId + ':' + item.trainingProblemId))
  const data = await request('/trainings/' + contest.id + '/problems', { session: teacherSession })
  const problems = items(data)
  if (problems.length !== problemSpecs.length) {
    throw new Error('比赛题目数量不完整，无法生成演示提交：' + contest.title)
  }
  for (const [studentIndex, student] of students.entries()) {
    for (const [problemIndex, problem] of problems.entries()) {
      const key = student.id + ':' + problem.id
      // 每场都保留可见的错误记录；ICPC 的错误还会计入负次数。
      if ((studentIndex + problemIndex) % 3 === 0 && !wrongExisting.has(key)) {
        await request('/trainings/' + contest.id + '/submit', {
          token: student.session,
          method: 'POST',
          body: { trainingProblemId: problem.id, language: 'cpp', code: '#include <bits/stdc++.h>\nint main(){return 0;}\n' },
        })
      }
      if (existing.has(key)) continue
      await request('/trainings/' + contest.id + '/submit', {
        token: student.session,
        method: 'POST',
        body: { trainingProblemId: problem.id, language: 'cpp', code: sources[problemIndex] },
      })
    }
  }
}

async function waitForJudge(teacherSession, ids) {
  const deadline = Date.now() + 480000
  while (Date.now() < deadline) {
    const states = await Promise.all(ids.map(async id => {
      const data = await request('/trainings/' + id + '/submissions?page=1&pageSize=200', { session: teacherSession })
      return items(data.submissions || data).some(item => item.result === 'queuing' || item.result === 'judging')
    }))
    if (!states.some(Boolean)) return
    await new Promise(resolve => setTimeout(resolve, 3000))
  }
  throw new Error('等待评测超时，请检查评测服务')
}

async function main() {
  const teacherSession = await throttledLogin(teacherName, teacherPassword, 'teacher')
  const team = await ensureTeam(teacherSession)
  const students = await ensureStudents(teacherSession)
  await ensureMembers(teacherSession, team, students)
  const problems = await ensureProblems(teacherSession)
  const all = await ensureContests(teacherSession, team, problems)
  // 已结束比赛不重新开启；首次创建时“已结束”比赛仍是 upcoming，会先完成提交再结束。
  const active = all.filter(item => item.state !== '未开始' && item.status !== 'finished')
  for (const contest of active) await createSubmissions(teacherSession, contest, students)
  await waitForJudge(teacherSession, active.map(item => item.id))
  for (const contest of all.filter(item => item.state === '已结束')) {
    await request('/trainings/' + contest.id + '/finish', { session: teacherSession, method: 'POST' })
  }
  console.log(JSON.stringify({
    success: true,
    teamId: team.id,
    users: students.map(item => item.username),
    contests: all.map(item => ({ id: item.id, title: item.title, expectedState: item.state })),
  }, null, 2))
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
