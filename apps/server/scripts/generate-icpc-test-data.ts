/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

/**
 * ICPC 训练测试数据生成脚本
 *
 * 为 Training ID=4 (ICPC 模拟赛) 创建测试提交数据
 * 覆盖场景：全AC、部分AC、零AC、多次尝试、管理员不计排名
 *
 * 注意：提交数据需要 cases 字段（JSON 测试点数据）才能通过过滤
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const TRAINING_ID = 4
// Will be loaded from database to avoid timezone issues
let TRAINING_START = new Date('2026-04-21 10:00:00')

// 题目的外部 ID (Submission.problemId = Problem.problemId)
const PROBLEM_EXTERNAL_IDS = [
  '1005', '1006', '1007', '1008', '1009',
  '1010', '1011', '1012', '1013', '1014'
]

// 学生 User.id（只计学生，教师不参与排名）
const STUDENTS = [
  { userId: '9a2cb00e-366b-4e12-99ca-4810276b7488', name: 'student1' },  // 李同学
  { userId: 'cd6f3162-3390-4dce-b763-1656f512dc1a', name: 'student2' },  // 王同学
  { userId: '7d320bf3-034a-41bd-a289-fc85b5db8178', name: 'student3' },  // 赵同学
  { userId: '9fb9b7b4-0675-4a37-977c-c886fb969e81', name: 'student4' },  // 刘同学
  { userId: '039d675b-5158-4ba2-a141-a95ab0ad6a23', name: 'student5' },  // 陈同学
  { userId: '746047ce-a424-45af-be83-6d1b98210899', name: 'student6' },  // 周同学
  { userId: '6a6b0e70-beef-4bcb-96ee-83bed99886fe', name: 'student7' },  // 吴同学
  { userId: '23a7bcfc-d97a-460b-aa54-545f09e72cab', name: 'student8' },  // 郑同学
  { userId: '149f1a3d-d561-4bb2-9766-565c6b031ecf', name: 'student9' },  // 孙同学
  { userId: '5a05e7c6-2264-40fc-a53d-ba991a0585b9', name: 'student10' }, // 钱同学
  { userId: 'a3957900-2dd3-4a9c-b178-5fe1bf2695cc', name: 'student' },   // 测试同学
]

// 教师 User.id（管理员，不计入排名）
const TEACHERS = [
  { userId: '0534666f-44d8-491a-b62e-771fd95eefaa', name: 'teacher1' },  // 张老师
  { userId: 'b4e38d19-2b5b-4832-aff0-9442288e8fc7', name: 'teacher3' },  // 王老师 (admin)
]

// 生成 cases JSON（模拟合法评测结果）
function makeCases(result: string, score: number) {
  return JSON.stringify([
    { caseId: 1, result, score: result === 'accepted' ? 100 : 0, timeUsed: Math.floor(Math.random() * 50) + 1, memoryUsed: Math.floor(Math.random() * 1024) + 256 },
    { caseId: 2, result, score: result === 'accepted' ? 100 : 0, timeUsed: Math.floor(Math.random() * 50) + 1, memoryUsed: Math.floor(Math.random() * 1024) + 256 },
  ])
}

// 分钟偏移 -> Date
function mins(m: number) {
  return new Date(TRAINING_START.getTime() + m * 60000)
}

async function createSubmission(
  userId: string,
  problemExternalId: string,
  result: string,
  score: number,
  createdAt: Date,
) {
  return prisma.submission.create({
    data: {
      userId,
      problemId: problemExternalId,
      oj: 'carits',
      language: 'cpp',
      code: '// ICPC training test submission',
      codeLength: 31,
      result,
      score,
      submitMethod: 'robot',
      submitSource: 'training',
      sourceId: `training-${TRAINING_ID}`,
      cases: makeCases(result, score),
      timeUsed: Math.floor(Math.random() * 100) + 1,
      memoryUsed: Math.floor(Math.random() * 2048) + 256,
      isGlobalVisible: true,
      createdAt,
      updatedAt: createdAt,
    } as any,
  })
}

async function main() {
  // Load actual training start time from database (avoid timezone issues)
  const training = await prisma.training.findUnique({
    where: { id: TRAINING_ID },
    select: { startTime: true },
  })
  if (training) {
    TRAINING_START = training.startTime
    console.log(`Loaded training start time from DB: ${TRAINING_START.toISOString()}`)
  } else {
    console.log(`Warning: Training ${TRAINING_ID} not found, using default start time`)
  }

  console.log('=== ICPC 训练测试数据生成 ===')
  console.log(`Training ID: ${TRAINING_ID}`)
  console.log(`Problems: ${PROBLEM_EXTERNAL_IDS.length}`)
  console.log(`Students: ${STUDENTS.length}`)
  console.log(`Teachers: ${TEACHERS.length}`)
  console.log('')

  let count = 0

  // === Student 0 (student1 李同学): 10/10 AC，低罚时 ===
  console.log('Student1: 10/10 AC, low penalty')
  for (let i = 0; i < 10; i++) {
    await createSubmission(STUDENTS[0].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(10 + i * 8))
    count++
  }

  // === Student 1 (student2 王同学): 10/10 AC，高罚时（多次尝试后 AC）===
  console.log('Student2: 10/10 AC, high penalty')
  const attempts2 = [3, 2, 1, 4, 1, 2, 1, 3, 1, 1]
  for (let i = 0; i < 10; i++) {
    const att = attempts2[i]
    for (let a = 0; a < att; a++) {
      const isLast = a === att - 1
      await createSubmission(
        STUDENTS[1].userId,
        PROBLEM_EXTERNAL_IDS[i],
        isLast ? 'accepted' : 'wrong_answer',
        isLast ? 100 : 0,
        mins(20 + i * 25 + a * 5),
      )
      count++
    }
  }

  // === Student 2 (student3 赵同学): 7/10 AC ===
  console.log('Student3: 7/10 AC')
  const ac3 = [true, true, true, false, true, true, true, false, false, false]
  for (let i = 0; i < 10; i++) {
    if (ac3[i]) {
      // 先 1-2 次 WA 再 AC
      const wa = i % 3
      for (let a = 0; a < wa; a++) {
        await createSubmission(STUDENTS[2].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(15 + i * 12 + a * 4))
        count++
      }
      await createSubmission(STUDENTS[2].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(15 + i * 12 + wa * 4))
      count++
    } else {
      // 2-3 次尝试未通过
      const wa = 2 + (i % 2)
      for (let a = 0; a < wa; a++) {
        await createSubmission(STUDENTS[2].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(15 + i * 12 + a * 3))
        count++
      }
    }
  }

  // === Student 3 (student4 刘同学): 7/10 AC（同解题数，罚时对比 student3）===
  console.log('Student4: 7/10 AC (different penalty)')
  const ac4 = [true, true, false, true, true, true, false, true, false, true]
  for (let i = 0; i < 10; i++) {
    if (ac4[i]) {
      await createSubmission(STUDENTS[3].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(30 + i * 15))
      count++
    } else {
      for (let a = 0; a < 2; a++) {
        await createSubmission(STUDENTS[3].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(30 + i * 15 + a * 3))
        count++
      }
    }
  }

  // === Student 4 (student5 陈同学): 6/10 AC ===
  console.log('Student5: 6/10 AC')
  const ac5 = [true, true, true, true, true, true, false, false, false, false]
  for (let i = 0; i < 10; i++) {
    if (ac5[i]) {
      const wa = i < 3 ? 0 : 1
      for (let a = 0; a < wa; a++) {
        await createSubmission(STUDENTS[4].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(25 + i * 10 + a * 6))
        count++
      }
      await createSubmission(STUDENTS[4].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(25 + i * 10 + wa * 6))
      count++
    } else {
      await createSubmission(STUDENTS[4].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(25 + i * 10))
      count++
    }
  }

  // === Student 5 (student6 周同学): 5/10 AC，高罚时 ===
  console.log('Student6: 5/10 AC, high penalty')
  const ac6 = [true, true, true, true, true, false, false, false, false, false]
  for (let i = 0; i < 10; i++) {
    if (ac6[i]) {
      const wa = 3 + (i % 3) // 3-5 次 WA 后 AC
      for (let a = 0; a < wa; a++) {
        await createSubmission(STUDENTS[5].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(40 + i * 20 + a * 4))
        count++
      }
      await createSubmission(STUDENTS[5].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(40 + i * 20 + wa * 4))
      count++
    } else {
      for (let a = 0; a < 3; a++) {
        await createSubmission(STUDENTS[5].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(40 + i * 20 + a * 5))
        count++
      }
    }
  }

  // === Student 6 (student7 吴同学): 4/10 AC ===
  console.log('Student7: 4/10 AC')
  const ac7 = [true, true, true, true, false, false, false, false, false, false]
  for (let i = 0; i < 10; i++) {
    if (ac7[i]) {
      await createSubmission(STUDENTS[6].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(50 + i * 8))
      count++
    } else {
      await createSubmission(STUDENTS[6].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(50 + i * 8))
      count++
    }
  }

  // === Student 7 (student8 郑同学): 3/10 AC ===
  console.log('Student8: 3/10 AC')
  const ac8 = [true, true, true, false, false, false, false, false, false, false]
  for (let i = 0; i < 10; i++) {
    if (ac8[i]) {
      await createSubmission(STUDENTS[7].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(60 + i * 10))
      count++
    } else {
      await createSubmission(STUDENTS[7].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(60 + i * 10))
      count++
    }
  }

  // === Student 8 (student9 孙同学): 2/10 AC ===
  console.log('Student9: 2/10 AC')
  const ac9 = [true, true, false, false, false, false, false, false, false, false]
  for (let i = 0; i < 10; i++) {
    if (ac9[i]) {
      await createSubmission(STUDENTS[8].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(70 + i * 5))
      count++
    } else {
      await createSubmission(STUDENTS[8].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(70 + i * 5))
      count++
    }
  }

  // === Student 9 (student10 钱同学): 1/10 AC，高罚时 ===
  console.log('Student10: 1/10 AC, high penalty')
  // 只 AC 第 0 题，但尝试了 5 次
  for (let a = 0; a < 5; a++) {
    await createSubmission(STUDENTS[9].userId, PROBLEM_EXTERNAL_IDS[0], a === 4 ? 'accepted' : 'wrong_answer', a === 4 ? 100 : 0, mins(80 + a * 10))
    count++
  }
  for (let i = 1; i < 10; i++) {
    await createSubmission(STUDENTS[9].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(80 + i * 5))
    count++
  }

  // === Student 10 (student 测试同学): 0/10 AC ===
  console.log('Student: 0/10 AC')
  for (let i = 0; i < 5; i++) {
    await createSubmission(STUDENTS[10].userId, PROBLEM_EXTERNAL_IDS[i], 'wrong_answer', 0, mins(90 + i * 8))
    count++
  }

  // === Teacher 0 (teacher1 张老师): 5/10 AC（不计入排名）===
  console.log('Teacher1: 5/10 AC (not in ranking)')
  const acT1 = [true, true, true, true, true, false, false, false, false, false]
  for (let i = 0; i < 10; i++) {
    if (acT1[i]) {
      await createSubmission(TEACHERS[0].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(5 + i * 6))
      count++
    }
  }

  // === Teacher 1 (teacher3 王老师 admin): 3/10 AC（不计入排名）===
  console.log('Teacher3: 3/10 AC (not in ranking)')
  const acT2 = [true, true, true, false, false, false, false, false, false, false]
  for (let i = 0; i < 10; i++) {
    if (acT2[i]) {
      await createSubmission(TEACHERS[1].userId, PROBLEM_EXTERNAL_IDS[i], 'accepted', 100, mins(8 + i * 7))
      count++
    }
  }

  console.log('')
  console.log(`=== 完成！共创建 ${count} 条提交 ===`)
  console.log('')

  // 打印预期排名
  console.log('预期 ICPC 排名（解题数降序 → 罚时升序）:')
  console.log('1. student1 (李同学)  - 10 solved, ~低罚时')
  console.log('2. student2 (王同学)  - 10 solved, ~高罚时')
  console.log('3-4. student3 (赵同学) / student4 (刘同学) - 7 solved, 按罚时排序')
  console.log('5. student5 (陈同学)  - 6 solved')
  console.log('6. student6 (周同学)  - 5 solved, 高罚时')
  console.log('7. student7 (吴同学)  - 4 solved')
  console.log('8. student8 (郑同学)  - 3 solved')
  console.log('9. student9 (孙同学)  - 2 solved')
  console.log('10. student10 (钱同学) - 1 solved, 高罚时')
  console.log('11. student (测试同学) - 0 solved')
  console.log('')
  console.log('不计排名: teacher1 (5 solved), teacher3 (3 solved)')
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
