/**
 * ICPC 训练真实提交测试脚本
 *
 * 通过 POST /api/trainings/:id/submit 真实提交代码到 go-judge 评测
 */
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-12345'
const TRAINING_ID = 4

// A+B 正确代码
const AC_CODE = `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << a + b << endl;
    return 0;
}`

// 输出 0 的代码（WA）
const WA_CODE = `#include <iostream>
using namespace std;
int main() {
    int a, b;
    cin >> a >> b;
    cout << 0 << endl;
    return 0;
}`

function makeToken(userId: string, studentId: string): string {
  return jwt.sign({ userId, role: 'student', studentId }, JWT_SECRET, { expiresIn: '7d' })
}

async function submitCode(
  token: string,
  trainingProblemId: string,
  code: string,
  language: string = 'cpp',
): Promise<{ ok: boolean; submissionId?: number; error?: string }> {
  try {
    const res = await fetch(`http://localhost:3002/api/trainings/${TRAINING_ID}/submit`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trainingProblemId, language, code, submitMethod: 'robot' }),
    })
    const data = await res.json()
    if (data.success && data.data?.submissionId) {
      return { ok: true, submissionId: data.data.submissionId }
    }
    return { ok: false, error: data.message || `HTTP ${res.status}` }
  } catch (e: any) {
    return { ok: false, error: e.message }
  }
}

function wait(ms: number) {
  return new Promise(r => setTimeout(r, ms))
}

async function waitForResult(submissionId: number, maxWaitMs = 15000): Promise<string> {
  const start = Date.now()
  while (Date.now() - start < maxWaitMs) {
    const sub = await prisma.submission.findUnique({
      where: { id: submissionId },
      select: { result: true },
    })
    if (sub && sub.result !== 'queuing') return sub.result
    await wait(1000)
  }
  return 'timeout'
}

async function main() {
  console.log('=== ICPC 训练真实提交测试 ===\n')

  // 获取训练信息
  const training = await prisma.training.findUnique({
    where: { id: TRAINING_ID },
    select: { teamId: true, startTime: true, endTime: true },
  })
  if (!training) { console.log('Training not found'); return }

  // 获取训练题目
  const problems = await prisma.trainingProblem.findMany({
    where: { trainingId: TRAINING_ID },
    orderBy: { orderIndex: 'asc' },
    select: { id: true, alias: true, Problem: { select: { problemId: true, title: true } } },
  })
  console.log(`题目: ${problems.length} 个`)

  // 获取团队成员中的学生
  const teamMembers = await prisma.teamMember.findMany({
    where: { teamId: training.teamId, status: 'active', userType: 'student', role: 'member' },
    select: { userId: true },
    take: 5,
  })

  type StudentInfo = { studentId: string; userId: string; name: string; token: string }
  const students: StudentInfo[] = []
  for (const m of teamMembers) {
    const student = await prisma.student.findUnique({
      where: { id: m.userId },
      select: { userId: true, name: true },
    })
    if (student) {
      students.push({
        studentId: m.userId,
        userId: student.userId,
        name: student.name,
        token: makeToken(student.userId, m.userId),
      })
    }
  }
  console.log(`学生: ${students.length} 个\n`)

  let count = 0
  let accepted = 0

  // === Student 1: 前 3 题 AC ===
  {
    const s = students[0]
    console.log(`--- ${s.name}: 前 3 题 AC ---`)
    for (let i = 0; i < 3; i++) {
      const res = await submitCode(s.token, problems[i].id, AC_CODE)
      if (res.ok && res.submissionId) {
        const result = await waitForResult(res.submissionId)
        console.log(`  ${problems[i].alias}: #${res.submissionId} → ${result}`)
        count++
        if (result === 'accepted') accepted++
      } else {
        console.log(`  ${problems[i].alias}: FAILED - ${res.error}`)
      }
      await wait(500)
    }
  }

  // === Student 2: 前 2 题 AC，第 3 题 WA ===
  {
    const s = students[1]
    console.log(`\n--- ${s.name}: 2 AC + 1 WA ---`)
    for (let i = 0; i < 2; i++) {
      const res = await submitCode(s.token, problems[i].id, AC_CODE)
      if (res.ok && res.submissionId) {
        const result = await waitForResult(res.submissionId)
        console.log(`  ${problems[i].alias} (AC): #${res.submissionId} → ${result}`)
        count++
        if (result === 'accepted') accepted++
      } else {
        console.log(`  ${problems[i].alias}: FAILED - ${res.error}`)
      }
      await wait(500)
    }
    // WA
    const res = await submitCode(s.token, problems[2].id, WA_CODE)
    if (res.ok && res.submissionId) {
      const result = await waitForResult(res.submissionId)
      console.log(`  ${problems[2].alias} (WA): #${res.submissionId} → ${result}`)
      count++
    } else {
      console.log(`  ${problems[2].alias}: FAILED - ${res.error}`)
    }
  }

  // === Student 3: 1 题 AC ===
  {
    const s = students[2]
    console.log(`\n--- ${s.name}: 1 AC ---`)
    const res = await submitCode(s.token, problems[0].id, AC_CODE)
    if (res.ok && res.submissionId) {
      const result = await waitForResult(res.submissionId)
      console.log(`  ${problems[0].alias}: #${res.submissionId} → ${result}`)
      count++
      if (result === 'accepted') accepted++
    }
  }

  // === Student 4: 全 WA ===
  {
    const s = students[3]
    console.log(`\n--- ${s.name}: 全 WA ---`)
    for (let i = 0; i < 2; i++) {
      const res = await submitCode(s.token, problems[i].id, WA_CODE)
      if (res.ok && res.submissionId) {
        const result = await waitForResult(res.submissionId)
        console.log(`  ${problems[i].alias} (WA): #${res.submissionId} → ${result}`)
        count++
      }
      await wait(500)
    }
  }

  // === Student 5: 1 次 WA 然后 AC ===
  {
    const s = students[4]
    console.log(`\n--- ${s.name}: 1 WA then AC ---`)
    const wa = await submitCode(s.token, problems[0].id, WA_CODE)
    if (wa.ok && wa.submissionId) {
      const result = await waitForResult(wa.submissionId)
      console.log(`  ${problems[0].alias} (WA): #${wa.submissionId} → ${result}`)
      count++
    }
    await wait(500)
    const ac = await submitCode(s.token, problems[0].id, AC_CODE)
    if (ac.ok && ac.submissionId) {
      const result = await waitForResult(ac.submissionId)
      console.log(`  ${problems[0].alias} (AC): #${ac.submissionId} → ${result}`)
      count++
      if (result === 'accepted') accepted++
    }
  }

  console.log(`\n=== 完成！${count} 条提交，${accepted} 条 Accepted ===`)

  // 验证排名
  const student0 = students[0]
  const token = makeToken(student0.userId, student0.studentId)
  const rankRes = await fetch(`http://localhost:3002/api/trainings/${TRAINING_ID}/ranking`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const rankData = await rankRes.json()
  if (rankData.success) {
    console.log('\n排名结果:')
    rankData.data.ranking.forEach((r: any, i: number) => {
      if (r.solvedCount > 0) {
        console.log(`  ${i + 1}. ${r.name.padEnd(10)} solved=${r.solvedCount} penalty=${r.totalPenalty}`)
      }
    })
  }

  await prisma.$disconnect()
}

main().catch(console.error)
