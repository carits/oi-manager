/**
 * MLE 检测测试脚本
 * 通过 oi-manager 提交 API 测试 MLE 检测功能
 */

import { prisma } from '../src/prisma'
import { getJwtSecret } from '../src/lib/jwtSecret'
import jwt from 'jsonwebtoken'

const API_URL = 'http://localhost:3002'

async function main() {
  console.log('=== MLE 检测测试 ===\n')

  // 获取 Training 4 和题目
  const training = await prisma.training.findUnique({
    where: { id: 4 },
    include: {
      TrainingProblem: {
        include: { Problem: true },
        orderBy: { orderIndex: 'asc' }
      }
    }
  })

  if (!training) {
    console.error('Training 4 不存在')
    return
  }

  console.log(`训练: ${training.title}`)
  console.log(`题目数: ${training.TrainingProblem.length}`)

  const firstProblem = training.TrainingProblem[0]
  console.log(`测试题目: ${firstProblem?.Problem?.problemId} - ${firstProblem?.Problem?.title}\n`)

  // 获取一个学生用户
  const studentUser = await prisma.user.findFirst({
    where: { role: 'student', status: 'active' },
    include: { Student: true }
  })

  if (!studentUser || !studentUser.Student) {
    console.error('没有找到学生用户')
    return
  }

  console.log(`测试用户: ${studentUser.username} (Student ID: ${studentUser.Student.id})\n`)

  // 生成 JWT Token
  const payload = {
    userId: studentUser.id,
    role: studentUser.role,
    username: studentUser.username,
    studentId: studentUser.Student.id,
    schoolId: studentUser.schoolId
  }

  const token = jwt.sign(payload, getJwtSecret(), { expiresIn: '7d' })
  console.log('Token 已生成\n')

  // MLE 测试代码（动态分配内存 - 确保实际分配超过 256MB 限制）
  const mleCode = `
#include <iostream>
#include <cstdlib>
using namespace std;
int main() {
  // 动态分配 300MB，确保超过 256MB 限制
  const int size = 300 * 1024 * 1024;  // 300MB
  char* arr = new char[size];
  // 写入数据确保实际分配
  for(int i = 0; i < size; i += 4096) arr[i] = i % 256;
  cout << arr[0] << endl;
  delete[] arr;
  return 0;
}
`

  // 提交 MLE 代码
  console.log('提交 MLE 测试代码...')

  const response = await fetch(`${API_URL}/api/trainings/4/submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({
      trainingProblemId: firstProblem?.id,
      language: 'cpp',
      code: mleCode
    })
  })

  const result = await response.json()
  console.log('提交响应:', JSON.stringify(result, null, 2))

  if (!result.success) {
    console.error('提交失败:', result.message)
    return
  }

  const submissionId = result.data?.submissionId
  console.log(`\n提交 ID: ${submissionId}`)
  console.log('等待评测结果...\n')

  // 等待评测完成
  let attempts = 0
  const maxAttempts = 30

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 1000))
    attempts++

    const statusRes = await fetch(`${API_URL}/api/submissions/${submissionId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    const status = await statusRes.json()

    if (status.success && status.data) {
      const { result: judgeResult, memory, time } = status.data

      if (judgeResult !== 'Pending' && judgeResult !== 'Judging') {
        console.log(`评测完成！`)
        console.log(`结果: ${judgeResult}`)
        console.log(`内存: ${memory} KB`)
        console.log(`时间: ${time} ms`)

        if (judgeResult === 'Memory Limit Exceeded') {
          console.log('\n✅ MLE 检测成功！程序被正确标记为内存超限')
        } else if (judgeResult === 'Runtime Error') {
          console.log('\n⚠️ 结果为 RE，需要检查是否应该为 MLE')
        } else if (judgeResult === 'Accepted') {
          console.log('\n❌ MLE 检测失败！程序通过了，内存限制未生效')
        } else {
          console.log(`\n⚠️ 其他结果: ${judgeResult}`)
        }

        break
      }

      console.log(`[${attempts}/${maxAttempts}] 状态: ${judgeResult}`)
    }
  }

  if (attempts >= maxAttempts) {
    console.log('评测超时')
  }

  await prisma.$disconnect()
}

main().catch(console.error)