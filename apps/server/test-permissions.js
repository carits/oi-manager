const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function test() {
  // 获取教师信息
  const teacher = await prisma.teacher.findFirst({ where: { name: "张老师" } });
  const teacher2 = await prisma.teacher.findFirst({ where: { name: "李老师" } });
  
  console.log("=== 测试教师 ===");
  console.log("张老师 ID:", teacher.id);
  console.log("李老师 ID:", teacher2.id);
  
  // 1. 检查教师作为成员的团队
  const teacherMemberships = await prisma.teamMember.findMany({
    where: { userId: teacher.id, userType: "teacher" },
    include: { team: { select: { name: true, ownerType: true } } }
  });
  
  console.log("\n=== 张老师作为成员的团队 ===");
  teacherMemberships.forEach(m => {
    console.log("  " + m.team.name + " - role: " + m.role + ", ownerType: " + m.team.ownerType);
  });
  
  // 2. 检查"学生独立团队48号"
  const team48 = await prisma.team.findFirst({
    where: { name: { contains: "学生独立团队48" } },
    include: { members: true }
  });
  
  if (team48) {
    console.log("\n=== 学生独立团队48号 ===");
    console.log("ID:", team48.id);
    console.log("OwnerType:", team48.ownerType);
    console.log("成员:");
    team48.members.forEach(m => {
      console.log("  userId: " + m.userId.substring(0,8) + "..., userType: " + m.userType + ", role: " + m.role);
    });
    
    // 检查张老师是否在这个团队
    const teacherInTeam = team48.members.find(m => m.userId === teacher.id && m.userType === "teacher");
    if (teacherInTeam) {
      console.log("\n⚠️ 问题：张老师在这个学生团队中！role:", teacherInTeam.role);
    } else {
      console.log("\n✓ 张老师不在这个团队中");
    }
  }
  
  // 3. 模拟 API 调用
  console.log("\n=== 模拟 API: GET /api/teams?teacherId=张老师&view=mine ===");
  const myMemberships = await prisma.teamMember.findMany({
    where: { userId: teacher.id, userType: "teacher", status: "active" },
    select: { teamId: true }
  });
  const myTeamIds = myMemberships.map(m => m.teamId);
  
  const myTeams = await prisma.team.findMany({
    where: { id: { in: myTeamIds } },
    select: { name: true, ownerType: true }
  });
  
  console.log("返回团队数:", myTeams.length);
  myTeams.forEach(t => console.log("  " + t.name + " (" + t.ownerType + " owner)"));
  
  // 检查是否有学生创建的团队
  const studentOwnedInMine = myTeams.filter(t => t.ownerType === "student");
  if (studentOwnedInMine.length > 0) {
    console.log("\n⚠️ 问题：我的团队中有 " + studentOwnedInMine.length + " 个学生创建的团队！");
  }
  
  await prisma.$disconnect();
}

test();
