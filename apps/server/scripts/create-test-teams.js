const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const schoolId = 'school-default';

  // 获取所有教师和学生
  const teachers = await prisma.teacher.findMany({ select: { id: true, name: true } });
  const students = await prisma.student.findMany({ select: { id: true, name: true } });

  console.log(`教师: ${teachers.length}, 学生: ${students.length}`);
  console.log('创建测试团队...\n');

  // 检查团队是否已存在
  const checkAndCreate = async (id, data) => {
    const exists = await prisma.team.findUnique({ where: { id } });
    if (exists) {
      console.log(`跳过 ${id} - 已存在`);
      return null;
    }
    return prisma.team.create({ data });
  };

  // ========== 团队1-5: 教师所有者 ==========

  // 1. 教师所有者 + 学生管理员 + 3名学生 (私有)
  let t1 = await checkAndCreate('team-test-01', { id: 'team-test-01', name: '算法入门班', description: '算法基础', schoolId, ownerId: teachers[0].id, ownerType: 'teacher', isPublic: false });
  if (t1) {
    await prisma.teamAdmin.create({ data: { teamId: t1.id, adminId: students[0].id, adminType: 'student', status: 'active', addedBy: teachers[0].id } });
    for (let i = 1; i <= 3; i++) {
      await prisma.studentTeam.create({ data: { teamId: t1.id, studentId: students[i].id, status: 'active', invitedBy: teachers[0].id } });
    }
    console.log('1. 算法入门班 - 教师所有者 + 学生管理员 + 3名学生 (私有)');
  }

  // 2. 教师所有者 + 教师管理员 + 5名学生 (公有)
  let t2 = await checkAndCreate('team-test-02', { id: 'team-test-02', name: '数学建模队', schoolId, ownerId: teachers[1].id, ownerType: 'teacher', isPublic: true });
  if (t2) {
    if (teachers[2]) await prisma.teamAdmin.create({ data: { teamId: t2.id, adminId: teachers[2].id, adminType: 'teacher', status: 'active', addedBy: teachers[1].id } });
    for (let i = 5; i <= 9; i++) {
      await prisma.studentTeam.create({ data: { teamId: t2.id, studentId: students[i].id, status: 'active', invitedBy: teachers[1].id } });
    }
    console.log('2. 数学建模队 - 教师所有者 + 教师管理员 + 5名学生 (公有)');
  }

  // 3. 教师所有者 + 2名学生管理员 + 15名学生 (公有)
  let t3 = await checkAndCreate('team-test-03', { id: 'team-test-03', name: '竞赛集训队', schoolId, ownerId: teachers[0].id, ownerType: 'teacher', isPublic: true });
  if (t3) {
    for (let i = 10; i <= 11; i++) {
      await prisma.teamAdmin.create({ data: { teamId: t3.id, adminId: students[i].id, adminType: 'student', status: 'active', addedBy: teachers[0].id } });
    }
    for (let i = 12; i <= 26; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t3.id, studentId: students[i].id, status: 'active', invitedBy: teachers[0].id } });
    }
    console.log('3. 竞赛集训队 - 教师所有者 + 2名学生管理员 + 15名学生 (公有)');
  }

  // 4. 教师所有者 + 只有1名学生 (私有)
  let t4 = await checkAndCreate('team-test-04', { id: 'team-test-04', name: '一对一辅导', schoolId, ownerId: teachers[1].id, ownerType: 'teacher', isPublic: false });
  if (t4) {
    await prisma.studentTeam.create({ data: { teamId: t4.id, studentId: students[30].id, status: 'active', invitedBy: teachers[1].id } });
    console.log('4. 一对一辅导 - 教师所有者 + 1名学生 (私有)');
  }

  // 5. 教师所有者 + 空成员 (私有)
  let t5 = await checkAndCreate('team-test-05', { id: 'team-test-05', name: '新建空团队', schoolId, ownerId: teachers[2].id, ownerType: 'teacher', isPublic: false });
  if (t5) console.log('5. 新建空团队 - 教师所有者 + 无成员 (私有)');

  // ========== 团队6-10: 学生所有者 ==========

  // 6. 学生所有者 + 教师管理员 + 2名学生 (公有)
  let t6 = await checkAndCreate('team-test-06', { id: 'team-test-06', name: '学生自学小组', schoolId, ownerId: students[5].id, ownerType: 'student', isPublic: true });
  if (t6) {
    await prisma.teamAdmin.create({ data: { teamId: t6.id, adminId: teachers[0].id, adminType: 'teacher', status: 'active', addedBy: students[5].id } });
    for (let i = 6; i <= 7; i++) {
      await prisma.studentTeam.create({ data: { teamId: t6.id, studentId: students[i].id, status: 'active', invitedBy: students[5].id } });
    }
    console.log('6. 学生自学小组 - 学生所有者 + 教师管理员 + 2名学生 (公有)');
  }

  // 7. 学生所有者 + 学生管理员 + 8名学生 (公有)
  let t7 = await checkAndCreate('team-test-07', { id: 'team-test-07', name: '编程爱好者', schoolId, ownerId: students[15].id, ownerType: 'student', isPublic: true });
  if (t7) {
    await prisma.teamAdmin.create({ data: { teamId: t7.id, adminId: students[16].id, adminType: 'student', status: 'active', addedBy: students[15].id } });
    for (let i = 17; i <= 24; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t7.id, studentId: students[i].id, status: 'active', invitedBy: students[15].id } });
    }
    console.log('7. 编程爱好者 - 学生所有者 + 学生管理员 + 8名学生 (公有)');
  }

  // 8. 学生所有者 + 教师成员(非管理员) + 3名学生 (私有)
  let t8 = await checkAndCreate('team-test-08', { id: 'team-test-08', name: '精英研究小组', schoolId, ownerId: students[25].id, ownerType: 'student', isPublic: false });
  if (t8) {
    await prisma.teacherTeam.create({ data: { teamId: t8.id, teacherId: teachers[1].id, status: 'active', invitedBy: students[25].id } });
    for (let i = 26; i <= 28; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t8.id, studentId: students[i].id, status: 'active', invitedBy: students[25].id } });
    }
    console.log('8. 精英研究小组 - 学生所有者 + 教师成员 + 3名学生 (私有)');
  }

  // 9. 学生所有者 + 只有自己 (公有)
  let t9 = await checkAndCreate('team-test-09', { id: 'team-test-09', name: '个人学习空间', schoolId, ownerId: students[35].id, ownerType: 'student', isPublic: true });
  if (t9) console.log('9. 个人学习空间 - 学生所有者 + 无其他成员 (公有)');

  // 10. 学生所有者 + 2名学生管理员 (公有)
  let t10 = await checkAndCreate('team-test-10', { id: 'team-test-10', name: '学习互助组', schoolId, ownerId: students[40].id, ownerType: 'student', isPublic: true });
  if (t10) {
    for (let i = 41; i <= 42; i++) {
      if (students[i]) {
        await prisma.teamAdmin.create({ data: { teamId: t10.id, adminId: students[i].id, adminType: 'student', status: 'active', addedBy: students[40].id } });
      }
    }
    console.log('10. 学习互助组 - 学生所有者 + 2名学生管理员，无普通成员 (公有)');
  }

  // ========== 团队11-15: 混合情况 ==========

  // 11. 教师所有者 + 学生+教师管理员 + 教师成员 + 6名学生 (公有)
  let t11 = await checkAndCreate('team-test-11', { id: 'team-test-11', name: '综合实践团队', schoolId, ownerId: teachers[3].id, ownerType: 'teacher', isPublic: true });
  if (t11) {
    await prisma.teamAdmin.create({ data: { teamId: t11.id, adminId: students[45].id, adminType: 'student', status: 'active', addedBy: teachers[3].id } });
    await prisma.teamAdmin.create({ data: { teamId: t11.id, adminId: teachers[0].id, adminType: 'teacher', status: 'active', addedBy: teachers[3].id } });
    await prisma.teacherTeam.create({ data: { teamId: t11.id, teacherId: teachers[1].id, status: 'active', invitedBy: teachers[3].id } });
    for (let i = 46; i <= 51; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t11.id, studentId: students[i].id, status: 'active', invitedBy: teachers[3].id } });
    }
    console.log('11. 综合实践团队 - 教师所有者 + 学生+教师管理员 + 教师成员 + 6名学生 (公有)');
  }

  // 12. 学生所有者 + 学生+教师管理员 (私有)
  let t12 = await checkAndCreate('team-test-12', { id: 'team-test-12', name: '创新创业小组', schoolId, ownerId: students[52].id, ownerType: 'student', isPublic: false });
  if (t12) {
    await prisma.teamAdmin.create({ data: { teamId: t12.id, adminId: students[53].id, adminType: 'student', status: 'active', addedBy: students[52].id } });
    if (teachers[2]) await prisma.teamAdmin.create({ data: { teamId: t12.id, adminId: teachers[2].id, adminType: 'teacher', status: 'active', addedBy: students[52].id } });
    console.log('12. 创新创业小组 - 学生所有者 + 学生+教师管理员，无普通成员 (私有)');
  }

  // 13. 教师所有者 + 只有教师成员 (私有)
  let t13 = await checkAndCreate('team-test-13', { id: 'team-test-13', name: '教师教研组', schoolId, ownerId: teachers[0].id, ownerType: 'teacher', isPublic: false });
  if (t13) {
    await prisma.teamAdmin.create({ data: { teamId: t13.id, adminId: teachers[1].id, adminType: 'teacher', status: 'active', addedBy: teachers[0].id } });
    if (teachers[2]) await prisma.teacherTeam.create({ data: { teamId: t13.id, teacherId: teachers[2].id, status: 'active', invitedBy: teachers[0].id } });
    console.log('13. 教师教研组 - 教师所有者 + 教师管理员 + 教师成员，无学生 (私有)');
  }

  // 14. 学生所有者 + 只有学生 (公有)
  let t14 = await checkAndCreate('team-test-14', { id: 'team-test-14', name: '课后学习小组', schoolId, ownerId: students[55].id, ownerType: 'student', isPublic: true });
  if (t14) {
    for (let i = 56; i <= 60; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t14.id, studentId: students[i].id, status: 'active', invitedBy: students[55].id } });
    }
    console.log('14. 课后学习小组 - 学生所有者 + 5名学生，无教师 (公有)');
  }

  // 15. 教师所有者 + 大团队 (公有)
  let t15 = await checkAndCreate('team-test-15', { id: 'team-test-15', name: '全校编程社', description: '全校编程社团', schoolId, ownerId: teachers[0].id, ownerType: 'teacher', isPublic: true });
  if (t15) {
    for (let i = 0; i < 3; i++) {
      await prisma.teamAdmin.create({ data: { teamId: t15.id, adminId: students[i].id, adminType: 'student', status: 'active', addedBy: teachers[0].id } });
    }
    await prisma.teamAdmin.create({ data: { teamId: t15.id, adminId: teachers[1].id, adminType: 'teacher', status: 'active', addedBy: teachers[0].id } });
    for (let i = 3; i <= 50; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t15.id, studentId: students[i].id, status: 'active', invitedBy: teachers[0].id } });
    }
    for (let i = 2; i <= 3; i++) {
      if (teachers[i]) await prisma.teacherTeam.create({ data: { teamId: t15.id, teacherId: teachers[i].id, status: 'active', invitedBy: teachers[0].id } });
    }
    console.log('15. 全校编程社 - 教师所有者 + 3名学生+1名教师管理员 + 48名学生 + 2名教师成员 (公有)');
  }

  // ========== 团队16-20: 特殊情况 ==========

  // 16. 只有所有者一人 (私有)
  let t16 = await checkAndCreate('team-test-16', { id: 'team-test-16', name: '私人笔记', schoolId, ownerId: students[61].id, ownerType: 'student', isPublic: false });
  if (t16) console.log('16. 私人笔记 - 只有学生所有者一人 (私有)');

  // 17. 只有所有者一人 (公有)
  let t17 = await checkAndCreate('team-test-17', { id: 'team-test-17', name: '新建公开团队', schoolId, ownerId: teachers[2].id, ownerType: 'teacher', isPublic: true });
  if (t17) console.log('17. 新建公开团队 - 只有教师所有者一人 (公有)');

  // 18. 所有管理员，无普通成员 (私有)
  let t18 = await checkAndCreate('team-test-18', { id: 'team-test-18', name: '管理团队', schoolId, ownerId: teachers[1].id, ownerType: 'teacher', isPublic: false });
  if (t18) {
    await prisma.teamAdmin.create({ data: { teamId: t18.id, adminId: students[62].id, adminType: 'student', status: 'active', addedBy: teachers[1].id } });
    await prisma.teamAdmin.create({ data: { teamId: t18.id, adminId: teachers[0].id, adminType: 'teacher', status: 'active', addedBy: teachers[1].id } });
    console.log('18. 管理团队 - 教师所有者 + 学生+教师管理员，无普通成员 (私有)');
  }

  // 19. 学生所有者 + 教师成员但无教师管理员 (公有)
  let t19 = await checkAndCreate('team-test-19', { id: 'team-test-19', name: '师生协作项目', schoolId, ownerId: students[63].id, ownerType: 'student', isPublic: true });
  if (t19) {
    for (let i = 0; i <= 2; i++) {
      await prisma.teacherTeam.create({ data: { teamId: t19.id, teacherId: teachers[i].id, status: 'active', invitedBy: students[63].id } });
    }
    for (let i = 64; i <= 68; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t19.id, studentId: students[i].id, status: 'active', invitedBy: students[63].id } });
    }
    console.log('19. 师生协作项目 - 学生所有者 + 3名教师成员(非管理员) + 5名学生 (公有)');
  }

  // 20. 有待处理邀请的团队 (公有)
  let t20 = await checkAndCreate('team-test-20', { id: 'team-test-20', name: '待招募团队', schoolId, ownerId: teachers[0].id, ownerType: 'teacher', isPublic: true });
  if (t20) {
    for (let i = 65; i <= 67; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t20.id, studentId: students[i].id, status: 'active', invitedBy: teachers[0].id } });
    }
    for (let i = 68; i <= 72; i++) {
      if (students[i]) await prisma.studentTeam.create({ data: { teamId: t20.id, studentId: students[i].id, status: 'pending', invitedBy: teachers[0].id } });
    }
    console.log('20. 待招募团队 - 教师所有者 + 3名已加入学生 + 5名待处理邀请 (公有)');
  }

  console.log('\n✅ 成功创建20个测试团队！');

  // 统计
  const stats = await Promise.all([
    prisma.team.count(),
    prisma.studentTeam.count(),
    prisma.teacherTeam.count(),
    prisma.teamAdmin.count()
  ]);
  console.log(`\n统计: 团队${stats[0]} | 学生关系${stats[1]} | 教师关系${stats[2]} | 管理员${stats[3]}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
