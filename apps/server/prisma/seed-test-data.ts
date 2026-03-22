import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('开始创建测试数据...')

  // 创建超级管理员
  const adminPassword = await bcrypt.hash('123456', 10)
  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      passwordHash: adminPassword,
      role: 'super_admin',
      status: 'active'
    }
  })
  console.log('✓ 创建超级管理员: admin / 123456')

  // 创建平台管理员
  const platformAdminsData = [
    { username: 'platform_admin1', name: '平台管理员1' },
    { username: 'platform_admin2', name: '平台管理员2' },
    { username: 'platform_admin3', name: '平台管理员3' }
  ]

  for (const adminData of platformAdminsData) {
    const adminPassword = await bcrypt.hash('123456', 10)
    const adminUser = await prisma.user.upsert({
      where: { username: adminData.username },
      update: {},
      create: {
        username: adminData.username,
        passwordHash: adminPassword,
        role: 'platform_admin',
        status: 'active'
      }
    })

    const existingTeacher = await prisma.teacher.findFirst({
      where: { userId: adminUser.id }
    })

    if (!existingTeacher) {
      await prisma.teacher.create({
        data: {
          name: adminData.name,
          userId: adminUser.id
        }
      })
    }
  }
  console.log(`✓ 创建 ${platformAdminsData.length} 个平台管理员`)

  // 为第一中学创建负责人
  const principal1Password = await bcrypt.hash('123456', 10)
  const principal1User = await prisma.user.upsert({
    where: { username: 'principal1' },
    update: {},
    create: {
      username: 'principal1',
      passwordHash: principal1Password,
      role: 'school_principal',
      status: 'active'
    }
  })

  const existingPrincipal1 = await prisma.teacher.findFirst({
    where: { userId: principal1User.id }
  })

  const principal1 = existingPrincipal1 || await prisma.teacher.create({
    data: {
      name: '张校长',
      title: '校长',
      userId: principal1User.id
    }
  })

  // 创建第一中学（必须有负责人）
  const school1 = await prisma.school.create({
    data: {
      name: '第一中学',
      region: '北京市/北京市/海淀区',
      schoolType: '初中+高中',
      educationSystem: '6-3-3',
      contactPerson: '张主任',
      contactPhone: '13700137000',
      contactEmail: 'zhang@example.com',
      status: 'active',
      currentPrincipalTeacherId: principal1.id
    }
  })
  console.log('✓ 创建学校: 第一中学')

  // 更新教师的学校ID
  await prisma.teacher.update({
    where: { id: principal1.id },
    data: { schoolId: school1.id }
  })
  console.log('✓ 创建学校负责人: principal1 / 123456')

  // 为第一中学创建团队
  const existingTeam1 = await prisma.team.findFirst({
    where: { name: 'ACM集训队', schoolId: school1.id }
  })

  const team1 = existingTeam1 || await prisma.team.create({
    data: {
      name: 'ACM集训队',
      schoolId: school1.id,
      leaderId: principal1.id
    }
  })
  console.log('✓ 创建团队: ACM集训队')

  // 为第一中学创建学生
  const students1Data = [
    { username: 'chen_yi', name: '陈一', enrollmentYear: 2023, rating: 1600 },
    { username: 'chen_er', name: '陈二', enrollmentYear: 2023, rating: 1550 },
    { username: 'chen_san', name: '陈三', enrollmentYear: 2022, rating: 1700 }
  ]

  for (const studentData of students1Data) {
    const studentPassword = await bcrypt.hash('123456', 10)
    const studentUser = await prisma.user.upsert({
      where: { username: studentData.username },
      update: {},
      create: {
        username: studentData.username,
        passwordHash: studentPassword,
        role: 'student',
        status: 'active'
      }
    })

    const existingStudent = await prisma.student.findFirst({
      where: { userId: studentUser.id }
    })

    if (!existingStudent) {
      const student = await prisma.student.create({
        data: {
          name: studentData.name,
          enrollmentYear: studentData.enrollmentYear,
          rating: studentData.rating,
          userId: studentUser.id,
          schoolId: school1.id,
          headTeacherId: principal1.id
        }
      })

      // 将学生加入团队（多对多关系）
      await prisma.studentTeam.create({
        data: {
          studentId: student.id,
          teamId: team1.id
        }
      })
    }
  }
  console.log(`✓ 创建 ${students1Data.length} 个学生`)

  // 为实验中学创建负责人
  const principal2Password = await bcrypt.hash('123456', 10)
  const principal2User = await prisma.user.upsert({
    where: { username: 'principal2' },
    update: {},
    create: {
      username: 'principal2',
      passwordHash: principal2Password,
      role: 'school_principal',
      status: 'active'
    }
  })

  const existingPrincipal2 = await prisma.teacher.findFirst({
    where: { userId: principal2User.id }
  })

  const principal2 = existingPrincipal2 || await prisma.teacher.create({
    data: {
      name: '李校长',
      title: '校长',
      userId: principal2User.id
    }
  })

  // 创建实验中学（必须有负责人）
  const school2 = await prisma.school.create({
    data: {
      name: '实验中学',
      region: '广东省/深圳市/南山区',
      schoolType: '初中+高中',
      educationSystem: '6-3-3',
      contactPerson: '李主任',
      contactPhone: '13800138000',
      contactEmail: 'lzr@example.com',
      status: 'active',
      currentPrincipalTeacherId: principal2.id
    }
  })
  console.log('✓ 创建学校: 实验中学')

  // 更新教师的学校ID
  await prisma.teacher.update({
    where: { id: principal2.id },
    data: { schoolId: school2.id }
  })
  console.log('✓ 创建学校负责人: principal2 / 123456')

  // 为实验中学创建团队
  const existingTeam2 = await prisma.team.findFirst({
    where: { name: '竞赛一队', schoolId: school2.id }
  })

  const team2 = existingTeam2 || await prisma.team.create({
    data: {
      name: '竞赛一队',
      schoolId: school2.id,
      leaderId: principal2.id
    }
  })
  console.log('✓ 创建团队: 竞赛一队')

  // 为实验中学创建学生
  const students2Data = [
    { username: 'wang_xiaoming', name: '王小明', enrollmentYear: 2023, rating: 1450 },
    { username: 'zhang_xiaohong', name: '张小红', enrollmentYear: 2023, rating: 1380 },
    { username: 'li_xiaogang', name: '李小刚', enrollmentYear: 2022, rating: 1520 },
    { username: 'zhao_xiaoli', name: '赵小丽', enrollmentYear: 2022, rating: 1490 },
    { username: 'liu_xiaoqiang', name: '刘小强', enrollmentYear: 2024, rating: 1200 }
  ]

  for (const studentData of students2Data) {
    const studentPassword = await bcrypt.hash('123456', 10)
    const studentUser = await prisma.user.upsert({
      where: { username: studentData.username },
      update: {},
      create: {
        username: studentData.username,
        passwordHash: studentPassword,
        role: 'student',
        status: 'active'
      }
    })

    const existingStudent = await prisma.student.findFirst({
      where: { userId: studentUser.id }
    })

    if (!existingStudent) {
      const student = await prisma.student.create({
        data: {
          name: studentData.name,
          enrollmentYear: studentData.enrollmentYear,
          rating: studentData.rating,
          userId: studentUser.id,
          schoolId: school2.id,
          headTeacherId: principal2.id
        }
      })

      // 将学生加入团队（多对多关系）
      await prisma.studentTeam.create({
        data: {
          studentId: student.id,
          teamId: team2.id
        }
      })
    }
  }
  console.log(`✓ 创建 ${students2Data.length} 个学生`)

  // 为育才高中创建负责人
  const principal3Password = await bcrypt.hash('123456', 10)
  const principal3User = await prisma.user.upsert({
    where: { username: 'principal3' },
    update: {},
    create: {
      username: 'principal3',
      passwordHash: principal3Password,
      role: 'school_principal',
      status: 'active'
    }
  })

  const existingPrincipal3 = await prisma.teacher.findFirst({
    where: { userId: principal3User.id }
  })

  const principal3 = existingPrincipal3 || await prisma.teacher.create({
    data: {
      name: '周主任',
      title: '教务主任',
      userId: principal3User.id
    }
  })

  // 创建育才高中（必须有负责人）
  const school3 = await prisma.school.create({
    data: {
      name: '育才高中',
      region: '湖南省/长沙市/岳麓区',
      schoolType: '高中',
      educationSystem: '6-3-3',
      contactPerson: '周老师',
      contactPhone: '13900139000',
      contactEmail: 'zhou@example.com',
      status: 'active',
      currentPrincipalTeacherId: principal3.id
    }
  })
  console.log('✓ 创建学校: 育才高中')

  // 更新教师的学校ID
  await prisma.teacher.update({
    where: { id: principal3.id },
    data: { schoolId: school3.id }
  })
  console.log('✓ 创建学校负责人: principal3 / 123456')

  // 为雅礼中学创建负责人（使用 teacher 作为用户名）
  const yaliPrincipalPassword = await bcrypt.hash('123456', 10)
  const yaliPrincipalUser = await prisma.user.upsert({
    where: { username: 'teacher' },
    update: {},
    create: {
      username: 'teacher',
      passwordHash: yaliPrincipalPassword,
      role: 'school_principal',
      status: 'active'
    }
  })

  const existingYaliPrincipal = await prisma.teacher.findFirst({
    where: { userId: yaliPrincipalUser.id }
  })

  const yaliPrincipal = existingYaliPrincipal || await prisma.teacher.create({
    data: {
      name: '王老师',
      title: '校长',
      userId: yaliPrincipalUser.id
    }
  })

  // 创建雅礼中学（必须有负责人）
  const yaliSchool = await prisma.school.create({
    data: {
      name: '雅礼中学',
      region: '湖南省/长沙市/雨花区',
      schoolType: '初中+高中',
      educationSystem: '6-3-3',
      contactPerson: '王老师',
      contactPhone: '13600136000',
      contactEmail: 'wang@yali.com',
      status: 'active',
      currentPrincipalTeacherId: yaliPrincipal.id
    }
  })
  console.log('✓ 创建学校: 雅礼中学')

  // 更新教师的学校ID
  await prisma.teacher.update({
    where: { id: yaliPrincipal.id },
    data: { schoolId: yaliSchool.id }
  })
  console.log('✓ 创建学校负责人: teacher / 123456')

  // 为雅礼中学创建4个普通教师
  const yaliTeachersData = [
    { username: 'teacher_liu', name: '刘教练', title: '金牌教练' },
    { username: 'teacher_chen', name: '陈老师', title: '高级教师' },
    { username: 'teacher_huang', name: '黄老师', title: '教师' },
    { username: 'teacher_xu', name: '徐老师', title: '助教' }
  ]

  const yaliTeachers = []
  for (const teacherData of yaliTeachersData) {
    const teacherPassword = await bcrypt.hash('123456', 10)
    const teacherUser = await prisma.user.upsert({
      where: { username: teacherData.username },
      update: {},
      create: {
        username: teacherData.username,
        passwordHash: teacherPassword,
        role: 'teacher',
        status: 'active'
      }
    })

    const existingTeacher = await prisma.teacher.findFirst({
      where: { userId: teacherUser.id }
    })

    const teacher = existingTeacher || await prisma.teacher.create({
      data: {
        name: teacherData.name,
        title: teacherData.title,
        userId: teacherUser.id,
        schoolId: yaliSchool.id
      }
    })

    yaliTeachers.push(teacher)
  }
  console.log(`✓ 创建 ${yaliTeachersData.length} 个教师`)

  // 为雅礼中学创建2个团队
  const yaliTeam1 = await prisma.team.create({
    data: {
      name: '竞赛强化班',
      schoolId: yaliSchool.id,
      leaderId: yaliPrincipal.id
    }
  })
  console.log('✓ 创建团队: 竞赛强化班')

  const yaliTeam2 = await prisma.team.create({
    data: {
      name: '算法基础班',
      schoolId: yaliSchool.id,
      leaderId: yaliTeachers[0].id
    }
  })
  console.log('✓ 创建团队: 算法基础班')

  // 为雅礼中学创建40个学生（不同年级）
  const yaliStudentsData = [
    // 初一学生 (2024年入学) - 10人
    { username: 'stu_yali_01', name: '张明', enrollmentYear: 2024, rating: 1150 },
    { username: 'stu_yali_02', name: '李华', enrollmentYear: 2024, rating: 1180 },
    { username: 'stu_yali_03', name: '王芳', enrollmentYear: 2024, rating: 1200 },
    { username: 'stu_yali_04', name: '刘强', enrollmentYear: 2024, rating: 1220 },
    { username: 'stu_yali_05', name: '陈静', enrollmentYear: 2024, rating: 1190 },
    { username: 'stu_yali_06', name: '赵伟', enrollmentYear: 2024, rating: 1210 },
    { username: 'stu_yali_07', name: '孙丽', enrollmentYear: 2024, rating: 1170 },
    { username: 'stu_yali_08', name: '周杰', enrollmentYear: 2024, rating: 1230 },
    { username: 'stu_yali_09', name: '吴敏', enrollmentYear: 2024, rating: 1160 },
    { username: 'stu_yali_10', name: '郑涛', enrollmentYear: 2024, rating: 1240 },

    // 初二学生 (2023年入学) - 10人
    { username: 'stu_yali_11', name: '冯超', enrollmentYear: 2023, rating: 1300 },
    { username: 'stu_yali_12', name: '何琳', enrollmentYear: 2023, rating: 1320 },
    { username: 'stu_yali_13', name: '许波', enrollmentYear: 2023, rating: 1280 },
    { username: 'stu_yali_14', name: '曹雪', enrollmentYear: 2023, rating: 1350 },
    { username: 'stu_yali_15', name: '严军', enrollmentYear: 2023, rating: 1310 },
    { username: 'stu_yali_16', name: '华丽', enrollmentYear: 2023, rating: 1290 },
    { username: 'stu_yali_17', name: '金鹏', enrollmentYear: 2023, rating: 1330 },
    { username: 'stu_yali_18', name: '魏霞', enrollmentYear: 2023, rating: 1270 },
    { username: 'stu_yali_19', name: '陶勇', enrollmentYear: 2023, rating: 1340 },
    { username: 'stu_yali_20', name: '姜萍', enrollmentYear: 2023, rating: 1360 },

    // 初三学生 (2022年入学) - 10人
    { username: 'stu_yali_21', name: '戚建', enrollmentYear: 2022, rating: 1420 },
    { username: 'stu_yali_22', name: '谢娟', enrollmentYear: 2022, rating: 1450 },
    { username: 'stu_yali_23', name: '邹磊', enrollmentYear: 2022, rating: 1400 },
    { username: 'stu_yali_24', name: '柏艳', enrollmentYear: 2022, rating: 1480 },
    { username: 'stu_yali_25', name: '水刚', enrollmentYear: 2022, rating: 1430 },
    { username: 'stu_yali_26', name: '窦红', enrollmentYear: 2022, rating: 1410 },
    { username: 'stu_yali_27', name: '章斌', enrollmentYear: 2022, rating: 1460 },
    { username: 'stu_yali_28', name: '云梅', enrollmentYear: 2022, rating: 1390 },
    { username: 'stu_yali_29', name: '苏峰', enrollmentYear: 2022, rating: 1470 },
    { username: 'stu_yali_30', name: '潘玲', enrollmentYear: 2022, rating: 1440 },

    // 高一学生 (2024年入学) - 5人
    { username: 'stu_yali_31', name: '葛浩', enrollmentYear: 2024, rating: 1500 },
    { username: 'stu_yali_32', name: '奚婷', enrollmentYear: 2024, rating: 1520 },
    { username: 'stu_yali_33', name: '范宇', enrollmentYear: 2024, rating: 1480 },
    { username: 'stu_yali_34', name: '彭欣', enrollmentYear: 2024, rating: 1510 },
    { username: 'stu_yali_35', name: '鲁翔', enrollmentYear: 2024, rating: 1490 },

    // 高二学生 (2023年入学) - 3人
    { username: 'stu_yali_36', name: '韦杰', enrollmentYear: 2023, rating: 1600 },
    { username: 'stu_yali_37', name: '昌慧', enrollmentYear: 2023, rating: 1620 },
    { username: 'stu_yali_38', name: '马俊', enrollmentYear: 2023, rating: 1580 },

    // 高三学生 (2022年入学) - 2人
    { username: 'stu_yali_39', name: '苗凯', enrollmentYear: 2022, rating: 1700 },
    { username: 'stu_yali_40', name: '凤娜', enrollmentYear: 2022, rating: 1720 }
  ]

  for (let i = 0; i < yaliStudentsData.length; i++) {
    const studentData = yaliStudentsData[i]
    const studentPassword = await bcrypt.hash('123456', 10)
    const studentUser = await prisma.user.upsert({
      where: { username: studentData.username },
      update: {},
      create: {
        username: studentData.username,
        passwordHash: studentPassword,
        role: 'student',
        status: 'active'
      }
    })

    const existingStudent = await prisma.student.findFirst({
      where: { userId: studentUser.id }
    })

    if (!existingStudent) {
      // 根据 rating 分配到不同团队（高分进强化班，低分进基础班）
      const teamId = studentData.rating >= 1400 ? yaliTeam1.id : yaliTeam2.id

      // 分配主教练（轮流分配给5个老师）
      const teacherIndex = i % 5
      const headTeacherId = teacherIndex === 0 ? yaliPrincipal.id : yaliTeachers[teacherIndex - 1].id

      const student = await prisma.student.create({
        data: {
          name: studentData.name,
          enrollmentYear: studentData.enrollmentYear,
          rating: studentData.rating,
          userId: studentUser.id,
          schoolId: yaliSchool.id,
          headTeacherId: headTeacherId
        }
      })

      // 将学生加入团队（多对多关系）
      await prisma.studentTeam.create({
        data: {
          studentId: student.id,
          teamId: teamId
        }
      })
    }
  }
  console.log(`✓ 创建 ${yaliStudentsData.length} 个学生`)

  console.log('\n测试数据创建完成！')
  console.log('\n账号列表：')
  console.log('超级管理员: admin / 123456')
  console.log('平台管理员: platform_admin1, platform_admin2, platform_admin3 / 123456')
  console.log('第一中学负责人: principal1 / 123456')
  console.log('实验中学负责人: principal2 / 123456')
  console.log('育才高中负责人: principal3 / 123456')
  console.log('雅礼中学负责人: teacher / 123456')
  console.log('雅礼中学教师: teacher_liu, teacher_chen, teacher_huang, teacher_xu / 123456')
  console.log('学生账号: chen_yi, wang_xiaoming, stu_yali_01 ~ stu_yali_40 / 123456')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
