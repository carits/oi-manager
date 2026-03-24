import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

// 学生数据 - 入学年份
// 当前时间：2026年3月，学年：2025-2026
// 年级由学校类型和学制自动推断
const studentsData = [
  // 小学生（小学入学年份）
  { username: 'student1', name: '李同学', gender: '男', enrollmentYear: 2024, rating: 1203, phone: '13800001001', email: 'student1@example.com' }, // 小一
  { username: 'student2', name: '王同学', gender: '男', enrollmentYear: 2023, rating: 1201, phone: '13800001002', email: 'student2@example.com' }, // 小二
  { username: 'student3', name: '赵同学', gender: '女', enrollmentYear: 2022, rating: 1221, phone: '13800001003', email: 'student3@example.com' }, // 小三
  { username: 'student4', name: '刘同学', gender: '男', enrollmentYear: 2021, rating: 1206, phone: '13800001004', email: 'student4@example.com' }, // 小四
  { username: 'student5', name: '陈同学', gender: '女', enrollmentYear: 2020, rating: 1213, phone: '13800001005', email: 'student5@example.com' }, // 小五

  // 初中生（初中入学年份）
  { username: 'student6', name: '周同学', gender: '男', enrollmentYear: 2024, rating: 1201, phone: '13800001006', email: 'student6@example.com' }, // 初一
  { username: 'student7', name: '吴同学', gender: '男', enrollmentYear: 2023, rating: 1211, phone: '13800001007', email: 'student7@example.com' }, // 初二
  { username: 'student8', name: '郑同学', gender: '女', enrollmentYear: 2022, rating: 1208, phone: '13800001008', email: 'student8@example.com' }, // 初三
  { username: 'student9', name: '孙同学', gender: '男', enrollmentYear: 2024, rating: 1198, phone: '13800001009', email: 'student9@example.com' }, // 初一
  { username: 'student10', name: '钱同学', gender: '女', enrollmentYear: 2023, rating: 1202, phone: '13800001010', email: 'student10@example.com' }, // 初二
  { username: 'student11', name: '冯同学', gender: '男', enrollmentYear: 2022, rating: 1217, phone: '13800001011', email: 'student11@example.com' }, // 初三
  { username: 'student12', name: '褚同学', gender: '女', enrollmentYear: 2024, rating: 1227, phone: '13800001012', email: 'student12@example.com' }, // 初一

  // 高中生（高中入学年份）
  { username: 'student13', name: '卫同学', gender: '男', enrollmentYear: 2024, rating: 1207, phone: '13800001013', email: 'student13@example.com' }, // 高一
  { username: 'student14', name: '蒋同学', gender: '女', enrollmentYear: 2023, rating: 1205, phone: '13800001014', email: 'student14@example.com' }, // 高二
  { username: 'student15', name: '沈同学', gender: '男', enrollmentYear: 2022, rating: 1202, phone: '13800001015', email: 'student15@example.com' }, // 高三
  { username: 'student16', name: '杨同学', gender: '男', enrollmentYear: 2024, rating: 1195, phone: '13800001016', email: 'student16@example.com' }, // 高一
  { username: 'student17', name: '朱同学', gender: '女', enrollmentYear: 2023, rating: 1210, phone: '13800001017', email: 'student17@example.com' }, // 高二
  { username: 'student18', name: '秦同学', gender: '男', enrollmentYear: 2022, rating: 1215, phone: '13800001018', email: 'student18@example.com' }, // 高三
  { username: 'student19', name: '许同学', gender: '女', enrollmentYear: 2019, rating: 1198, phone: '13800001019', email: 'student19@example.com' }, // 小六
  { username: 'student20', name: '何同学', gender: '男', enrollmentYear: 2021, rating: 1205, phone: '13800001020', email: 'student20@example.com' }, // 小四

  // 高中毕业的学生
  { username: 'student21', name: '张毕业', gender: '男', enrollmentYear: 2019, rating: 1450, phone: '13800001021', email: 'student21@example.com' }, // 高中毕业 3 年
  { username: 'student22', name: '李毕业', gender: '女', enrollmentYear: 2020, rating: 1420, phone: '13800001022', email: 'student22@example.com' }, // 高中毕业 2 年
  { username: 'student23', name: '王毕业', gender: '男', enrollmentYear: 2021, rating: 1380, phone: '13800001023', email: 'student23@example.com' }, // 高中毕业 1 年
  { username: 'student24', name: '赵毕业', gender: '女', enrollmentYear: 2018, rating: 1500, phone: '13800001024', email: 'student24@example.com' }, // 高中毕业 4 年
  { username: 'student25', name: '刘毕业', gender: '男', enrollmentYear: 2020, rating: 1410, phone: '13800001025', email: 'student25@example.com' }, // 高中毕业 2 年
]
// 比赛数据 - 包含三种类型
const contestsData = [
  // 训练赛
  { title: '2024寒假训练赛第一场', date: '2024-01-15', status: 'finished', type: 'training', countRating: false },
  { title: '2024寒假训练赛第二场', date: '2024-01-22', status: 'finished', type: 'training', countRating: false },
  // 模拟赛
  { title: '2024春季模拟赛第一场', date: '2024-02-15', status: 'finished', type: 'mock', countRating: true },
  { title: '2024春季模拟赛第二场', date: '2024-03-01', status: 'finished', type: 'mock', countRating: true },
  { title: '2024春季模拟赛第三场', date: '2024-03-15', status: 'finished', type: 'mock', countRating: true },
  // 正赛
  { title: '2024省选模拟赛', date: '2024-04-01', status: 'finished', type: 'official', countRating: true },
]

async function main() {
  console.log('Seeding database...')

  // 创建超级管理员账号 (admin)
  const adminPassword = await bcrypt.hash('123456', 10)
  const adminUser = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPassword,
      role: 'super_admin',
      phone: '13800000000',
      email: 'admin@example.com',
      Teacher: {
        create: {
          name: '系统管理员',
          email: 'admin@example.com',
          phone: '13800000000',
          title: '超级管理员'
        }
      }
    }
  })

  // 创建老师用户 1
  const teacherPassword = await bcrypt.hash('123456', 10)
  const teacherUser = await prisma.user.upsert({
    where: { username: 'teacher' },
    update: {},
    create: {
      username: 'teacher',
      passwordHash: teacherPassword,
      role: 'teacher',
      phone: '13900000000',
      email: 'teacher@example.com',
      Teacher: {
        create: {
          name: '张老师',
          email: 'teacher@example.com',
          phone: '13900000000',
          title: '主教练'
        }
      }
    }
  })

  // 获取老师记录
  const teacher = await prisma.teacher.findUnique({ where: { userId: teacherUser.id } })

  if (!teacher) {
    throw new Error('Failed to create teacher')
  }

  // 创建默认学校（需要 currentPrincipalTeacherId）
  const school = await prisma.school.upsert({
    where: { id: 'school-default' },
    update: {},
    create: {
      id: 'school-default',
      name: '第一中学',
      announcement: '# 欢迎来到第一中学\n\n这是一所信息学竞赛重点学校。',
      currentPrincipalTeacherId: teacher.id
    }
  })

  // 更新张老师的学校
  await prisma.teacher.update({
    where: { id: teacher.id },
    data: { schoolId: school.id }
  })

  // 创建老师用户 2
  const teacher2User = await prisma.user.upsert({
    where: { username: 'teacher2' },
    update: {},
    create: {
      username: 'teacher2',
      passwordHash: teacherPassword,
      role: 'teacher',
      phone: '13900000001',
      email: 'teacher2@example.com',
      Teacher: {
        create: {
          name: '李老师',
          email: 'teacher2@example.com',
          phone: '13900000001',
          title: '副教练',
          schoolId: school.id
        }
      }
    }
  })

  // 创建老师用户 3
  const teacher3User = await prisma.user.upsert({
    where: { username: 'teacher3' },
    update: {},
    create: {
      username: 'teacher3',
      passwordHash: teacherPassword,
      role: 'teacher',
      phone: '13900000002',
      email: 'teacher3@example.com',
      Teacher: {
        create: {
          name: '王老师',
          email: 'teacher3@example.com',
          phone: '13900000002',
          title: '教练',
          schoolId: school.id
        }
      }
    }
  })

  // 获取老师记录
  const teacher2 = await prisma.teacher.findUnique({ where: { userId: teacher2User.id } })
  const teacher3 = await prisma.teacher.findUnique({ where: { userId: teacher3User.id } })

  if (!teacher2 || !teacher3) {
    throw new Error('Failed to create teachers')
  }

  // 设置张老师为学校负责人
  await prisma.school.update({
    where: { id: school.id },
    data: { currentPrincipalTeacherId: teacher.id }
  })

  // 更新张老师的用户角色为 school_principal
  await prisma.user.update({
    where: { id: teacherUser.id },
    data: { role: 'school_principal' }
  })

  console.log('设置张老师为学校负责人')

  // 创建团队 1 - 提高班（公有团队）
  const team1 = await prisma.team.upsert({
    where: { id: 'team-advanced' },
    update: {},
    create: {
      id: 'team-advanced',
      name: '提高班',
      description: '信息学竞赛提高班，面向有一定基础的学生',
      announcement: '# 提高班公告\n\n欢迎来到提高班！\n\n## 训练计划\n\n- **周一**：图论专题\n- **周三**：动态规划\n- **周五**：模拟赛\n\n请按时完成作业！',
      schoolId: school.id,
      isPublic: true
    }
  })

  // 创建团队 2 - 基础班（公有团队）
  const team2 = await prisma.team.upsert({
    where: { id: 'team-basic' },
    update: {},
    create: {
      id: 'team-basic',
      name: '基础班',
      description: '信息学竞赛基础班，适合初学者',
      announcement: '# 基础班公告\n\n欢迎加入基础班！\n\n## 本周任务\n\n1. 完成循环结构练习\n2. 学习数组基础\n3. 尝试简单排序',
      schoolId: school.id,
      isPublic: true
    }
  })

  // 创建团队 3 - 竞赛队（私有团队）
  const team3 = await prisma.team.upsert({
    where: { id: 'team-contest' },
    update: {},
    create: {
      id: 'team-contest',
      name: '竞赛队',
      description: '信息学竞赛主力队，仅限选拔学生',
      announcement: '# 竞赛队公告\n\n## 目标\n\n- NOIP 提高组一等奖\n- 省选冲刺\n\n加油！',
      schoolId: school.id,
      isPublic: false
    }
  })

  // === 使用新的 TeamMember 模型 ===

  // 创建团队成员 - 所有者
  // 提高班所有者 - 张老师
  await prisma.teamMember.upsert({
    where: {
      teamId_userId_userType: {
        teamId: team1.id,
        userId: teacher.id,
        userType: 'teacher'
      }
    },
    update: {},
    create: {
      teamId: team1.id,
      userId: teacher.id,
      userType: 'teacher',
      role: 'owner',
      status: 'active',
      joinedAt: new Date()
    }
  })

  // 基础班所有者 - 李老师
  await prisma.teamMember.upsert({
    where: {
      teamId_userId_userType: {
        teamId: team2.id,
        userId: teacher2.id,
        userType: 'teacher'
      }
    },
    update: {},
    create: {
      teamId: team2.id,
      userId: teacher2.id,
      userType: 'teacher',
      role: 'owner',
      status: 'active',
      joinedAt: new Date()
    }
  })

  // 竞赛队所有者 - 张老师
  await prisma.teamMember.upsert({
    where: {
      teamId_userId_userType: {
        teamId: team3.id,
        userId: teacher.id,
        userType: 'teacher'
      }
    },
    update: {},
    create: {
      teamId: team3.id,
      userId: teacher.id,
      userType: 'teacher',
      role: 'owner',
      status: 'active',
      joinedAt: new Date()
    }
  })

  // 为竞赛队添加王老师为管理员
  await prisma.teamMember.upsert({
    where: {
      teamId_userId_userType: {
        teamId: team3.id,
        userId: teacher3.id,
        userType: 'teacher'
      }
    },
    update: {},
    create: {
      teamId: team3.id,
      userId: teacher3.id,
      userType: 'teacher',
      role: 'admin',
      status: 'active',
      joinedAt: new Date(),
      invitedBy: teacher.id
    }
  })

  // 创建多个学生
  const students = []
  for (let i = 0; i < studentsData.length; i++) {
    const s = studentsData[i]
    const studentPassword = await bcrypt.hash('123456', 10)
    // 将学生分配到不同团队
    const studentNum = parseInt(s.username.replace('student', ''))
    // 将学生分配给3个教师
    const headTeacherId = studentNum % 3 === 0 ? teacher3.id : (studentNum % 3 === 1 ? teacher.id : teacher2.id)

    const user = await prisma.user.upsert({
      where: { username: s.username },
      update: {},
      create: {
        username: s.username,
        passwordHash: studentPassword,
        role: 'student',
        phone: s.phone,
        email: s.email,
        Student: {
          create: {
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

      // 根据学生序号分配不同的团队状态
      // 0-7: 已加入提高班
      // 8-15: 已加入基础班
      // 16-19: 待处理邀请（提高班）
      // 20-24: 加入申请待审批
      if (i < 8) {
        // 已加入提高班
        await prisma.teamMember.upsert({
          where: {
            teamId_userId_userType: {
              teamId: team1.id,
              userId: student.id,
              userType: 'student'
            }
          },
          update: {},
          create: {
            teamId: team1.id,
            userId: student.id,
            userType: 'student',
            role: 'member',
            status: 'active',
            joinedAt: new Date(),
            invitedBy: teacher.id
          }
        })
      } else if (i < 16) {
        // 已加入基础班
        await prisma.teamMember.upsert({
          where: {
            teamId_userId_userType: {
              teamId: team2.id,
              userId: student.id,
              userType: 'student'
            }
          },
          update: {},
          create: {
            teamId: team2.id,
            userId: student.id,
            userType: 'student',
            role: 'member',
            status: 'active',
            joinedAt: new Date(),
            invitedBy: teacher2.id
          }
        })
      } else if (i < 20) {
        // 待处理邀请（提高班邀请）
        await prisma.teamMember.upsert({
          where: {
            teamId_userId_userType: {
              teamId: team1.id,
              userId: student.id,
              userType: 'student'
            }
          },
          update: {},
          create: {
            teamId: team1.id,
            userId: student.id,
            userType: 'student',
            role: 'member',
            status: 'pending',
            invitedBy: teacher.id
          }
        })
      } else {
        // 加入申请待审批（申请加入基础班）
        await prisma.teamJoinRequest.upsert({
          where: {
            teamId_studentId: {
              teamId: team2.id,
              studentId: student.id
            }
          },
          update: {},
          create: {
            teamId: team2.id,
            studentId: student.id,
            status: 'pending',
            message: '我想加入基础班学习'
          }
        })
      }
    }
  }

  // 为竞赛队添加几个成员（已加入）
  for (let i = 0; i < 3; i++) {
    const student = students[i]
    if (student) {
      await prisma.teamMember.upsert({
        where: {
          teamId_userId_userType: {
            teamId: team3.id,
            userId: student.id,
            userType: 'student'
          }
        },
        update: {},
        create: {
          teamId: team3.id,
          userId: student.id,
          userType: 'student',
          role: 'member',
          status: 'active',
          joinedAt: new Date(),
          invitedBy: teacher.id
        }
      })
    }
  }

  console.log(`创建了 ${students.length} 个学生`)
  console.log('- 8 人已加入提高班')
  console.log('- 8 人已加入基础班')
  console.log('- 4 人有待处理邀请（提高班）')
  console.log('- 5 人有加入申请待审批（基础班）')
  console.log('- 3 人已加入竞赛队')

  // 创建题单
  const taskList = await prisma.taskList.upsert({
    where: { id: 'tasklist-1' },
    update: {},
    create: {
      id: 'tasklist-1',
      title: '图论基础练习',
      description: '本周图论基础题单，包含最短路和最小生成树',
      publishAt: new Date('2024-03-01'),
      deadline: new Date('2024-03-08'),
      createdBy: teacher.id,
      Task: {
        create: [
          { title: 'P3371 单源最短路径', ojName: '洛谷', problemId: 'P3371', difficulty: '入门', points: 10 },
          { title: 'P3366 最小生成树', ojName: '洛谷', problemId: 'P3366', difficulty: '中等', points: 15 },
          { title: 'P1346 观光之旅', ojName: '洛谷', problemId: 'P1346', difficulty: '困难', points: 20 },
          { title: 'P1339 热浪问题', ojName: '洛谷', problemId: 'P1339', difficulty: '入门', points: 10 },
          { title: 'P1126 机器人搬重物', ojName: '洛谷', problemId: 'P1126', difficulty: '中等', points: 15 }
        ]
      }
    }
  })

  // 获取题单中的任务
  const tasks = await prisma.task.findMany({ where: { taskListId: taskList.id } })

  // 为每个学生创建任务进度
  for (const student of students) {
    // 随机决定已完成和进行中的任务
    for (const task of tasks) {
      const rand = Math.random()
      let status = 'pending'
      if (rand > 0.6) {
        status = 'completed'
      } else if (rand > 0.3) {
        status = 'in_progress'
      }

      await prisma.taskProgress.upsert({
        where: {
          taskId_studentId: {
            taskId: task.id,
            studentId: student.id
          }
        },
        update: {},
        create: {
          taskId: task.id,
          studentId: student.id,
          status,
          seenEditorial: status === 'completed' ? Math.random() > 0.5 : false,
          needHelp: status === 'in_progress' ? Math.random() > 0.7 : false,
          notes: status === 'completed' ? '已完成' : null
        }
      })
    }
  }

  // 创建比赛和参赛结果
  let baseRating = 1200
  for (let c = 0; c < contestsData.length; c++) {
    const contestData = contestsData[c]

    const contest = await prisma.contest.upsert({
      where: { id: `contest-${c + 1}` },
      update: {},
      create: {
        id: `contest-${c + 1}`,
        title: contestData.title,
        description: `${contestData.title}`,
        contestDate: new Date(contestData.date),
        status: contestData.status,
        type: contestData.type || 'mock',
        countRating: contestData.countRating || false,
        scope: 'public',
        teamId: team1.id
      }
    })

    // 为每个学生生成参赛结果
    const sortedStudents = [...students].sort((a, b) => b.rating - a.rating)

    for (let i = 0; i < sortedStudents.length; i++) {
      const student = sortedStudents[i]
      const rank = i + 1
      const baseChange = Math.round((sortedStudents.length - rank) * 20 / sortedStudents.length)
      const randomChange = Math.floor(Math.random() * 20) - 10
      const ratingChange = baseChange + randomChange

      const ratingBefore = baseRating + (c === 0 ? student.rating - 1200 : 0)
      const ratingAfter = ratingBefore + ratingChange

      await prisma.contestResult.upsert({
        where: {
          contestId_studentId: {
            contestId: contest.id,
            studentId: student.id
          }
        },
        update: {},
        create: {
          contestId: contest.id,
          studentId: student.id,
          rank: rank,
          score: 100 - (rank - 1) * 10 + Math.floor(Math.random() * 10),
          ratingBefore,
          ratingAfter,
          ratingChange
        }
      })
    }

    // 更新学生的当前rating
    for (const student of sortedStudents) {
      const result = await prisma.contestResult.findFirst({
        where: { contestId: contest.id, studentId: student.id },
        orderBy: { createdAt: 'desc' }
      })
      if (result) {
        await prisma.student.update({
          where: { id: student.id },
          data: { rating: result.ratingAfter }
        })
      }
    }
  }

  // 创建里程碑 - 只给部分学生
  for (const student of students.slice(0, 5)) {
    await prisma.milestone.upsert({
      where: { id: `milestone-${student.id}` },
      update: {},
      create: {
        id: `milestone-${student.id}`,
        studentId: student.id,
        teacherId: teacher.id,
        title: '入班',
        description: '正式加入信息学竞赛提高班',
        milestoneDate: new Date('2024-01-01'),
        type: 'entry'
      }
    })
  }

  // 保留原来的student账号用于演示
  const originalStudentPassword = await bcrypt.hash('123456', 10)
  await prisma.user.upsert({
    where: { username: 'student' },
    update: {},
    create: {
      username: 'student',
      passwordHash: originalStudentPassword,
      role: 'student',
      phone: '13800138000',
      email: 'student@test.com',
      Student: {
        create: {
          name: '测试同学',
          gender: '男',
          schoolId: school.id,
          headTeacherId: teacher.id,
          targetContest: 'NOIP',
          rating: 1200
        }
      }
    }
  })

  // 创建50个测试团队，各种类型的所有者和管理者
  console.log('创建测试团队...')
  const teamTypes = [
    { prefix: '教师创建-学生管理', ownerType: 'teacher', adminType: 'student' },
    { prefix: '教师创建-教师管理', ownerType: 'teacher', adminType: 'teacher' },
    { prefix: '学生创建-学生管理', ownerType: 'student', adminType: 'student' },
    { prefix: '学生创建-教师管理', ownerType: 'student', adminType: 'teacher' },
    { prefix: '教师独立团队', ownerType: 'teacher', adminType: null },
    { prefix: '学生独立团队', ownerType: 'student', adminType: null },
  ]

  for (let i = 0; i < 50; i++) {
    const typeConfig = teamTypes[i % teamTypes.length]

    // 确定所有者
    let ownerId: string
    if (typeConfig.ownerType === 'teacher') {
      ownerId = (i % 2 === 0) ? teacher.id : teacher2.id
    } else {
      ownerId = students[i % students.length].id
    }

    // 创建团队（不再包含 ownerId/ownerType）
    const team = await prisma.team.create({
      data: {
        id: `test-team-${i + 1}`,
        name: `${typeConfig.prefix}${i + 1}号`,
        description: `这是一个测试团队，所有者类型: ${typeConfig.ownerType}`,
        schoolId: school.id,
        isPublic: (i + Math.floor(i / 6)) % 5 !== 0, // 约 80% 公开，20% 私有，均匀分布
      }
    })

    // 创建所有者的 TeamMember 记录
    await prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: ownerId,
        userType: typeConfig.ownerType,
        role: 'owner',
        status: 'active',
      }
    })

    // 创建管理员（如果有）
    if (typeConfig.adminType) {
      let adminId: string
      if (typeConfig.adminType === 'teacher') {
        adminId = typeConfig.ownerType === 'teacher'
          ? (ownerId === teacher.id ? teacher2.id : teacher.id)
          : teacher.id
      } else {
        adminId = students[(i + 5) % students.length].id
      }

      await prisma.teamMember.create({
        data: {
          teamId: team.id,
          userId: adminId,
          userType: typeConfig.adminType,
          role: 'admin',
          status: 'active',
          invitedBy: ownerId,
        }
      })
    }

    // 添加一些普通成员
    const memberCount = (i % 5) + 2 // 2-6 个成员
    for (let j = 0; j < memberCount; j++) {
      const memberIndex = (i + j * 3) % students.length
      const memberId = students[memberIndex].id

      // 避免重复添加
      const existing = await prisma.teamMember.findFirst({
        where: { teamId: team.id, userId: memberId, userType: 'student' }
      })
      if (!existing) {
        await prisma.teamMember.create({
          data: {
            teamId: team.id,
            userId: memberId,
            userType: 'student',
            role: 'member',
            status: j % 4 === 0 ? 'pending' : 'active', // 1/4 待处理
            invitedBy: ownerId,
          }
        })
      }
    }
  }

  console.log('创建了 50 个测试团队')

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