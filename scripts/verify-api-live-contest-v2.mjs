#!/usr/bin/env node

// Verification uses authenticated read APIs only. It does not write any data.
const base = process.env.DEMO_API_BASE || 'http://127.0.0.1:3002/api'
const teacherName = process.env.DEMO_TEACHER_USERNAME
const teacherPassword = process.env.DEMO_TEACHER_PASSWORD
const studentName = process.env.DEMO_V2_STUDENT_USERNAME || 'live_v2_01'
const studentPassword = process.env.DEMO_STUDENT_PASSWORD
for (const key of ['DEMO_TEACHER_USERNAME', 'DEMO_TEACHER_PASSWORD', 'DEMO_STUDENT_PASSWORD']) if (!process.env[key]) throw new Error('Missing environment variable: ' + key)
async function call(path, options = {}) {
  const response = await fetch(base + path, { headers: options.token ? { Authorization: 'Bearer ' + options.token } : {} })
  const json = await response.json()
  if (!response.ok || !json.success) throw new Error(path + ': ' + (json.message || response.status))
  return json.data
}
// Login needs a body; keep it explicit to avoid accepting an accidental anonymous check.
async function token(username, password, role) {
  const response = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password, role, workspaceMode: 'work' }) })
  const json = await response.json(); if (!response.ok || !json.success) throw new Error('login failed')
  return json.data.token
}
function rows(value) { return value?.submissions || value?.ranking || value?.data || value || [] }
async function main() {
  const teacher = await token(teacherName, teacherPassword, 'teacher')
  const student = await token(studentName, studentPassword, 'student')
  const trainings = await call('/teams/live_contest_v2_team/trainings?type=contest', { token: teacher })
  const v2 = rows(trainings).filter(item => item.title.startsWith('赛时演示 V2'))
  if (v2.length !== 9) throw new Error('Expected 9 V2 contests, got ' + v2.length)
  const report = []
  for (const contest of v2) {
    const problems = await call('/trainings/' + contest.id + '/problems', { token: teacher })
    if (rows(problems).length !== 5) throw new Error(contest.title + ': expected 5 problems')
    const adminSubs = await call('/trainings/' + contest.id + '/submissions?page=1&pageSize=200', { token: teacher }).catch(() => ({ submissions: [] }))
    const subs = rows(adminSubs)
    if (!contest.title.endsWith('未开始') && subs.length < 20) throw new Error(contest.title + ': expected at least 20 submissions')
    if (contest.title.endsWith('进行中') && contest.format === 'oi') {
      const rank = await call('/trainings/' + contest.id + '/ranking', { token: student })
      if (!rank.hidden) throw new Error(contest.title + ': OI student ranking must be hidden')
      const studentSubs = await call('/trainings/' + contest.id + '/submissions?page=1&pageSize=200', { token: student })
      if (rows(studentSubs).some(item => item.result !== 'submitted' || item.score != null || item.ojRemoteId != null)) throw new Error(contest.title + ': OI student details leaked')
    }
    if (!contest.title.endsWith('未开始') && (contest.format === 'ioi' || contest.format === 'icpc')) {
      const rank = await call('/trainings/' + contest.id + '/ranking', { token: student })
      if (!rank.hidden && rows(rank.ranking).length === 0 && !contest.title.endsWith('未开始')) throw new Error(contest.title + ': expected visible ranking')
    }
    report.push({ title: contest.title, format: contest.format, status: contest.status, submissions: subs.length, accepted: subs.filter(item => item.result === 'accepted').length, wrong: subs.filter(item => item.result === 'wa').length, partial: subs.filter(item => item.score > 0 && item.score < 100).length })
  }
  console.log(JSON.stringify({ success: true, contests: report }, null, 2))
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1 })
