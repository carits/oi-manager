import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// 平台学校 ID（用于系统管理员）
const PLATFORM_SCHOOL_ID = 'platform-school-00000000'

// 学生数据 - 入学年份
// 当前时间：2026年3月，学年：2025-2026
// 年级由学校类型和学制自动推断
const studentsData = [
  // 小学生（小学入学年份）
  { username: 'student1', name: '李同学', gender: '男', enrollmentYear: 2024, rating: 1203, phone: '13800001001', email: 'student1@example.com' },
  { username: 'student2', name: '王同学', gender: '男', enrollmentYear: 2023, rating: 1201, phone: '13800001002', email: 'student2@example.com' },
  { username: 'student3', name: '赵同学', gender: '女', enrollmentYear: 2022, rating: 1221, phone: '13800001003', email: 'student3@example.com' },
  { username: 'student4', name: '刘同学', gender: '男', enrollmentYear: 2021, rating: 1206, phone: '13800001004', email: 'student4@example.com' },
  { username: 'student5', name: '陈同学', gender: '女', enrollmentYear: 2020, rating: 1213, phone: '13800001005', email: 'student5@example.com' },

  // 初中生（初中入学年份）
  { username: 'student6', name: '周同学', gender: '男', enrollmentYear: 2024, rating: 1201, phone: '13800001006', email: 'student6@example.com' },
  { username: 'student7', name: '吴同学', gender: '男', enrollmentYear: 2023, rating: 1211, phone: '13800001007', email: 'student7@example.com' },
  { username: 'student8', name: '郑同学', gender: '女', enrollmentYear: 2022, rating: 1208, phone: '13800001008', email: 'student8@example.com' },
  { username: 'student9', name: '孙同学', gender: '男', enrollmentYear: 2024, rating: 1198, phone: '13800001009', email: 'student9@example.com' },
  { username: 'student10', name: '钱同学', gender: '女', enrollmentYear: 2023, rating: 1202, phone: '13800001010', email: 'student10@example.com' },
  { username: 'student11', name: '冯同学', gender: '男', enrollmentYear: 2022, rating: 1217, phone: '13800001011', email: 'student11@example.com' },
  { username: 'student12', name: '褚同学', gender: '女', enrollmentYear: 2024, rating: 1227, phone: '13800001012', email: 'student12@example.com' },

  // 高中生（高中入学年份）
  { username: 'student13', name: '卫同学', gender: '男', enrollmentYear: 2024, rating: 1207, phone: '13800001013', email: 'student13@example.com' },
  { username: 'student14', name: '蒋同学', gender: '女', enrollmentYear: 2023, rating: 1205, phone: '13800001014', email: 'student14@example.com' },
  { username: 'student15', name: '沈同学', gender: '男', enrollmentYear: 2022, rating: 1202, phone: '13800001015', email: 'student15@example.com' },
  { username: 'student16', name: '杨同学', gender: '男', enrollmentYear: 2024, rating: 1195, phone: '13800001016', email: 'student16@example.com' },
  { username: 'student17', name: '朱同学', gender: '女', enrollmentYear: 2023, rating: 1210, phone: '13800001017', email: 'student17@example.com' },
  { username: 'student18', name: '秦同学', gender: '男', enrollmentYear: 2022, rating: 1215, phone: '13800001018', email: 'student18@example.com' },
  { username: 'student19', name: '许同学', gender: '女', enrollmentYear: 2019, rating: 1198, phone: '13800001019', email: 'student19@example.com' },
  { username: 'student20', name: '何同学', gender: '男', enrollmentYear: 2021, rating: 1205, phone: '13800001020', email: 'student20@example.com' },

  // 高中毕业的学生
  { username: 'student21', name: '张毕业', gender: '男', enrollmentYear: 2019, rating: 1450, phone: '13800001021', email: 'student21@example.com' },
  { username: 'student22', name: '李毕业', gender: '女', enrollmentYear: 2020, rating: 1420, phone: '13800001022', email: 'student22@example.com' },
  { username: 'student23', name: '王毕业', gender: '男', enrollmentYear: 2021, rating: 1380, phone: '13800001023', email: 'student23@example.com' },
  { username: 'student24', name: '赵毕业', gender: '女', enrollmentYear: 2018, rating: 1500, phone: '13800001024', email: 'student24@example.com' },
  { username: 'student25', name: '刘毕业', gender: '男', enrollmentYear: 2020, rating: 1410, phone: '13800001025', email: 'student25@example.com' },
]

// 比赛数据 - 包含三种类型
const contestsData = [
  { title: '2024寒假训练赛第一场', date: '2024-01-15', status: 'finished', type: 'training', countRating: false },
  { title: '2024寒假训练赛第二场', date: '2024-01-22', status: 'finished', type: 'training', countRating: false },
  { title: '2024春季模拟赛第一场', date: '2024-02-15', status: 'finished', type: 'mock', countRating: true },
  { title: '2024春季模拟赛第二场', date: '2024-03-01', status: 'finished', type: 'mock', countRating: true },
  { title: '2024春季模拟赛第三场', date: '2024-03-15', status: 'finished', type: 'mock', countRating: true },
  { title: '2024省选模拟赛', date: '2024-04-01', status: 'finished', type: 'official', countRating: true },
]

async function main() {
  console.log('Seeding database...')

  // === Step 1: 创建平台学校（用于系统管理员） ===
  const platformSchool = await prisma.school.upsert({
    where: { id: PLATFORM_SCHOOL_ID },
    update: {},
    create: {
      id: PLATFORM_SCHOOL_ID,
      name: '平台管理',
      region: '系统',
      schoolType: '平台',
      status: 'active',
      currentPrincipalTeacherId: 'temp-placeholder'
    }
  })
  console.log('创建平台学校:', platformSchool.id)

  // === Step 2: 创建超级管理员账号 (admin) ===
  const adminPassword = await bcrypt.hash('123456', 10)
  const adminUserId = crypto.randomUUID()
  const adminTeacherId = crypto.randomUUID()
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      id: adminUserId,
      username: 'admin',
      passwordHash: adminPassword,
      role: 'super_admin',
      schoolId: PLATFORM_SCHOOL_ID, // 绑定到平台学校
      phone: '13800000000',
      email: 'admin@example.com',
      Teacher: {
        create: {
          id: adminTeacherId,
          name: '系统管理员',
          email: 'admin@example.com',
          phone: '13800000000',
          title: '超级管理员',
          schoolId: PLATFORM_SCHOOL_ID
        }
      }
    }
  })
  console.log('创建超级管理员: admin')

  // 更新平台学校的负责人为 admin 教师
  await prisma.school.update({
    where: { id: PLATFORM_SCHOOL_ID },
    data: { currentPrincipalTeacherId: adminTeacherId }
  })

  // === Step 3: 创建平台管理员账号 (platform_admin) ===
  const platformAdminPassword = await bcrypt.hash('123456', 10)
  const platformAdminUserId = crypto.randomUUID()
  const platformAdminAdminId = crypto.randomUUID()
  await prisma.user.upsert({
    where: { username: 'platform_admin' },
    update: {},
    create: {
      id: platformAdminUserId,
      username: 'platform_admin',
      passwordHash: platformAdminPassword,
      role: 'platform_admin',
      schoolId: PLATFORM_SCHOOL_ID, // 绑定到平台学校
      phone: '13800000001',
      email: 'platform_admin@example.com',
      Admin: {
        create: {
          id: platformAdminAdminId,
          name: '平台管理员',
          schoolId: PLATFORM_SCHOOL_ID
        }
      }
    }
  })
  console.log('创建平台管理员: platform_admin')

  // === Step 4: 创建默认学校 ===
  // 先创建学校（使用临时负责人）
  const school = await prisma.school.upsert({
    where: { id: 'school-default' },
    update: {},
    create: {
      id: 'school-default',
      name: '第一中学',
      announcement: '# 欢迎来到第一中学\n\n这是一所信息学竞赛重点学校。',
      currentPrincipalTeacherId: 'temp-placeholder'
    }
  })

  // === Step 5: 创建老师用户 ===
  const teacherPassword = await bcrypt.hash('123456', 10)

  // 张老师（学校负责人）
  const teacherUserId = crypto.randomUUID()
  const teacherId = crypto.randomUUID()

  // 检查用户是否存在
  const existingTeacher1 = await prisma.user.findUnique({ where: { username: 'teacher1' } })

  if (!existingTeacher1) {
    await prisma.user.create({
      data: {
        id: teacherUserId,
        username: 'teacher1',
        passwordHash: teacherPassword,
        role: 'school_principal',
        schoolId: school.id,
        phone: '13900000000',
        email: 'teacher@example.com',
        Teacher: {
          create: {
            id: teacherId,
            name: '张老师',
            email: 'teacher@example.com',
            phone: '13900000000',
            title: '主教练',
            schoolId: school.id
          }
        }
      }
    })
  } else {
    // 用户存在，确保 Teacher 记录也存在
    const existingTeacher = await prisma.teacher.findUnique({ where: { userId: existingTeacher1.id } })
    if (!existingTeacher) {
      await prisma.teacher.create({
        data: {
          id: teacherId,
          userId: existingTeacher1.id,
          name: '张老师',
          email: 'teacher@example.com',
          phone: '13900000000',
          title: '主教练',
          schoolId: school.id
        }
      })
    }
    // 更新用户的 schoolId
    await prisma.user.update({
      where: { id: existingTeacher1.id },
      data: { schoolId: school.id, role: 'school_principal' }
    })
  }

  // 获取最终的 teacherId
  const teacher1Record = await prisma.teacher.findFirst({ where: { User: { username: 'teacher1' } } })
  const finalTeacherId = teacher1Record?.id || teacherId

  // 更新学校负责人
  await prisma.school.update({
    where: { id: school.id },
    data: { currentPrincipalTeacherId: finalTeacherId }
  })
  console.log('创建学校负责人: teacher1 (张老师)')

  // 李老师
  const teacher2UserId = crypto.randomUUID()
  const teacher2Id = crypto.randomUUID()

  const existingTeacher2 = await prisma.user.findUnique({ where: { username: 'teacher2' } })
  if (!existingTeacher2) {
    await prisma.user.create({
      data: {
        id: teacher2UserId,
        username: 'teacher2',
        passwordHash: teacherPassword,
        role: 'teacher',
        schoolId: school.id,
        phone: '13900000001',
        email: 'teacher2@example.com',
        Teacher: {
          create: {
            id: teacher2Id,
            name: '李老师',
            email: 'teacher2@example.com',
            phone: '13900000001',
            title: '副教练',
            schoolId: school.id
          }
        }
      }
    })
  } else {
    const existingT2 = await prisma.teacher.findUnique({ where: { userId: existingTeacher2.id } })
    if (!existingT2) {
      await prisma.teacher.create({
        data: {
          id: teacher2Id,
          userId: existingTeacher2.id,
          name: '李老师',
          email: 'teacher2@example.com',
          phone: '13900000001',
          title: '副教练',
          schoolId: school.id
        }
      })
    }
    await prisma.user.update({
      where: { id: existingTeacher2.id },
      data: { schoolId: school.id }
    })
  }
  console.log('创建教师: teacher2 (李老师)')

  // 王老师
  const teacher3UserId = crypto.randomUUID()
  const teacher3Id = crypto.randomUUID()

  const existingTeacher3 = await prisma.user.findUnique({ where: { username: 'teacher3' } })
  if (!existingTeacher3) {
    await prisma.user.create({
      data: {
        id: teacher3UserId,
        username: 'teacher3',
        passwordHash: teacherPassword,
        role: 'teacher',
        schoolId: school.id,
        phone: '13900000002',
        email: 'teacher3@example.com',
        Teacher: {
          create: {
            id: teacher3Id,
            name: '王老师',
            email: 'teacher3@example.com',
            phone: '13900000002',
            title: '教练',
            schoolId: school.id
          }
        }
      }
    })
  } else {
    const existingT3 = await prisma.teacher.findUnique({ where: { userId: existingTeacher3.id } })
    if (!existingT3) {
      await prisma.teacher.create({
        data: {
          id: teacher3Id,
          userId: existingTeacher3.id,
          name: '王老师',
          email: 'teacher3@example.com',
          phone: '13900000002',
          title: '教练',
          schoolId: school.id
        }
      })
    }
    await prisma.user.update({
      where: { id: existingTeacher3.id },
      data: { schoolId: school.id }
    })
  }
  console.log('创建教师: teacher3 (王老师)')

  // 获取最终的教师 ID
  const t1 = await prisma.teacher.findFirst({ where: { User: { username: 'teacher1' } } })
  const t2 = await prisma.teacher.findFirst({ where: { User: { username: 'teacher2' } } })
  const t3 = await prisma.teacher.findFirst({ where: { User: { username: 'teacher3' } } })
  const finalT1Id = t1?.id || finalTeacherId
  const finalT2Id = t2?.id || teacher2Id
  const finalT3Id = t3?.id || teacher3Id

  // === Step 6: 创建团队 ===
  const team1 = await prisma.team.upsert({
    where: { id: 'team-advanced' },
    update: {},
    create: {
      id: 'team-advanced',
      name: '提高班',
      description: '信息学竞赛提高班，面向有一定基础的学生',
      announcement: '# 提高班公告\n\n欢迎来到提高班！',
      schoolId: school.id,
      isPublic: true
    }
  })

  const team2 = await prisma.team.upsert({
    where: { id: 'team-basic' },
    update: {},
    create: {
      id: 'team-basic',
      name: '基础班',
      description: '信息学竞赛基础班，适合初学者',
      schoolId: school.id,
      isPublic: true
    }
  })

  const team3 = await prisma.team.upsert({
    where: { id: 'team-contest' },
    update: {},
    create: {
      id: 'team-contest',
      name: '竞赛队',
      description: '信息学竞赛主力队',
      schoolId: school.id,
      isPublic: false
    }
  })

  // === Step 7: 创建团队成员 ===
  // 提高班所有者 - 张老师
  await prisma.teamMember.upsert({
    where: { teamId_userId_userType: { teamId: team1.id, userId: teacherId, userType: 'teacher' } },
    update: {},
    create: {
      id: crypto.randomUUID(),
      teamId: team1.id,
      userId: teacherId,
      userType: 'teacher',
      role: 'owner',
      status: 'active',
      joinedAt: new Date()
    }
  })

  // 基础班所有者 - 李老师
  await prisma.teamMember.upsert({
    where: { teamId_userId_userType: { teamId: team2.id, userId: teacher2Id, userType: 'teacher' } },
    update: {},
    create: {
      id: crypto.randomUUID(),
      teamId: team2.id,
      userId: teacher2Id,
      userType: 'teacher',
      role: 'owner',
      status: 'active',
      joinedAt: new Date()
    }
  })

  // 竞赛队所有者 - 张老师，管理员 - 王老师
  await prisma.teamMember.upsert({
    where: { teamId_userId_userType: { teamId: team3.id, userId: teacherId, userType: 'teacher' } },
    update: {},
    create: {
      id: crypto.randomUUID(),
      teamId: team3.id,
      userId: teacherId,
      userType: 'teacher',
      role: 'owner',
      status: 'active',
      joinedAt: new Date()
    }
  })

  await prisma.teamMember.upsert({
    where: { teamId_userId_userType: { teamId: team3.id, userId: teacher3Id, userType: 'teacher' } },
    update: {},
    create: {
      id: crypto.randomUUID(),
      teamId: team3.id,
      userId: teacher3Id,
      userType: 'teacher',
      role: 'admin',
      status: 'active',
      joinedAt: new Date(),
      invitedBy: teacherId
    }
  })

  // === Step 8: 创建学生 ===
  const students = []
  for (let i = 0; i < studentsData.length; i++) {
    const s = studentsData[i]
    const studentPassword = await bcrypt.hash('123456', 10)
    const studentNum = parseInt(s.username.replace('student', ''))
    const headTeacherId = studentNum % 3 === 0 ? teacher3Id : (studentNum % 3 === 1 ? teacherId : teacher2Id)

    const studentUserId = crypto.randomUUID()
    const studentId = crypto.randomUUID()

    const user = await prisma.user.upsert({
      where: { username: s.username },
      update: {},
      create: {
        id: studentUserId,
        username: s.username,
        passwordHash: studentPassword,
        role: 'student',
        schoolId: school.id, // 学生绑定到学校
        phone: s.phone,
        email: s.email,
        Student: {
          create: {
            id: studentId,
            name: s.name,
            gender: s.gender,
            schoolId: school.id,
            headTeacherId: headTeacherId,
            enrollmentYear: s.enrollmentYear,
            targetContest: 'NOIP',
            rating: s.rating
          }
        }
      }
    })

    const student = await prisma.student.findUnique({ where: { userId: user.id } })
    if (student) {
      students.push(student)

      // 分配团队
      if (i < 8) {
        await prisma.teamMember.upsert({
          where: { teamId_userId_userType: { teamId: team1.id, userId: student.id, userType: 'student' } },
          update: {},
          create: {
            id: crypto.randomUUID(),
            teamId: team1.id,
            userId: student.id,
            userType: 'student',
            role: 'member',
            status: 'active',
            joinedAt: new Date(),
            invitedBy: teacherId
          }
        })
      } else if (i < 16) {
        await prisma.teamMember.upsert({
          where: { teamId_userId_userType: { teamId: team2.id, userId: student.id, userType: 'student' } },
          update: {},
          create: {
            id: crypto.randomUUID(),
            teamId: team2.id,
            userId: student.id,
            userType: 'student',
            role: 'member',
            status: 'active',
            joinedAt: new Date(),
            invitedBy: teacher2Id
          }
        })
      } else if (i < 20) {
        await prisma.teamMember.upsert({
          where: { teamId_userId_userType: { teamId: team1.id, userId: student.id, userType: 'student' } },
          update: {},
          create: {
            id: crypto.randomUUID(),
            teamId: team1.id,
            userId: student.id,
            userType: 'student',
            role: 'member',
            status: 'pending',
            invitedBy: teacherId
          }
        })
      } else {
        await prisma.teamJoinRequest.upsert({
          where: { teamId_studentId: { teamId: team2.id, studentId: student.id } },
          update: {},
          create: {
            id: crypto.randomUUID(),
            teamId: team2.id,
            studentId: student.id,
            status: 'pending',
            message: '我想加入基础班学习'
          }
        })
      }
    }
  }

  // 竞赛队添加成员
  for (let i = 0; i < 3; i++) {
    const student = students[i]
    if (student) {
      await prisma.teamMember.upsert({
        where: { teamId_userId_userType: { teamId: team3.id, userId: student.id, userType: 'student' } },
        update: {},
        create: {
          id: crypto.randomUUID(),
          teamId: team3.id,
          userId: student.id,
          userType: 'student',
          role: 'member',
          status: 'active',
          joinedAt: new Date(),
          invitedBy: teacherId
        }
      })
    }
  }

  console.log(`创建了 ${students.length} 个学生`)

  // === Step 9: 创建比赛 ===
  let baseRating = 1200
  for (let c = 0; c < contestsData.length; c++) {
    const contestData = contestsData[c]
    const contest = await prisma.contest.upsert({
      where: { id: `contest-${c + 1}` },
      update: {},
      create: {
        id: `contest-${c + 1}`,
        title: contestData.title,
        description: contestData.title,
        contestDate: new Date(contestData.date),
        status: contestData.status,
        type: contestData.type || 'mock',
        countRating: contestData.countRating || false,
        scope: 'public',
        teamId: team1.id
      }
    })

    const sortedStudents = [...students].sort((a, b) => b.rating - a.rating)
    for (let i = 0; i < sortedStudents.length; i++) {
      const student = sortedStudents[i]
      const rank = i + 1
      const ratingChange = Math.round((sortedStudents.length - rank) * 20 / sortedStudents.length) + Math.floor(Math.random() * 20) - 10
      const ratingBefore = baseRating + (c === 0 ? student.rating - 1200 : 0)
      const ratingAfter = ratingBefore + ratingChange

      await prisma.contestResult.upsert({
        where: { contestId_studentId: { contestId: contest.id, studentId: student.id } },
        update: {},
        create: {
          id: crypto.randomUUID(),
          contestId: contest.id,
          studentId: student.id,
          rank,
          score: 100 - (rank - 1) * 10 + Math.floor(Math.random() * 10),
          ratingBefore,
          ratingAfter,
          ratingChange
        }
      })
    }
  }

  // === Step 10: 创建里程碑 ===
  for (const student of students.slice(0, 5)) {
    await prisma.milestone.upsert({
      where: { id: `milestone-${student.id}` },
      update: {},
      create: {
        id: `milestone-${student.id}`,
        studentId: student.id,
        teacherId: teacherId,
        title: '入班',
        description: '正式加入信息学竞赛提高班',
        milestoneDate: new Date('2024-01-01'),
        type: 'entry'
      }
    })
  }

  // === Step 11: 创建演示学生账号 ===
  const originalStudentPassword = await bcrypt.hash('123456', 10)
  await prisma.user.upsert({
    where: { username: 'student' },
    update: {},
    create: {
      id: crypto.randomUUID(),
      username: 'student',
      passwordHash: originalStudentPassword,
      role: 'student',
      schoolId: school.id,
      phone: '13800138000',
      email: 'student@test.com',
      Student: {
        create: {
          id: crypto.randomUUID(),
          name: '测试同学',
          gender: '男',
          schoolId: school.id,
          headTeacherId: teacherId,
          targetContest: 'NOIP',
          rating: 1200
        }
      }
    }
  })
  console.log('创建演示学生: student')

  console.log('Seeding completed!')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })