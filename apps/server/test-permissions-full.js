const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function test() {
  console.log("========================================");
  console.log("     团队权限全面测试");
  console.log("========================================\n");
  
  // 获取教师信息
  const teachers = await prisma.teacher.findMany({ select: { id: true, name: true } });
  const students = await prisma.student.findMany({ select: { id: true, name: true }, take: 5 });
  
  console.log("=== 测试用户 ===");
  teachers.forEach(t => console.log("  教师: " + t.name + " (" + t.id.substring(0,8) + "...)"));
  students.forEach(s => console.log("  学生: " + s.name + " (" + s.id.substring(0,8) + "...)"));
  
  const teacher = teachers.find(t => t.name === "张老师");
  const teacher2 = teachers.find(t => t.name === "李老师");
  
  // 1. 测试"我的团队" API (view=mine)
  console.log("\n=== 测试 1: 张老师的\"我的团队\" ===");
  const myMemberships = await prisma.teamMember.findMany({
    where: { userId: teacher.id, userType: "teacher", status: "active" },
    include: { team: { select: { name: true, ownerType: true, isPublic: true } } }
  });
  
  console.log("团队数: " + myMemberships.length);
  
  const myTeamStats = { owner: 0, admin: 0, member: 0 };
  const studentOwnedInMine = [];
  myMemberships.forEach(m => {
    myTeamStats[m.role]++;
    if (m.team.ownerType === "student") {
      studentOwnedInMine.push({ name: m.team.name, role: m.role });
    }
  });
  
  console.log("  - 所有者: " + myTeamStats.owner);
  console.log("  - 管理员: " + myTeamStats.admin);
  console.log("  - 成员: " + myTeamStats.member);
  
  if (studentOwnedInMine.length > 0) {
    console.log("\n  ✓ 学生创建的团队 (我是管理员/成员):");
    studentOwnedInMine.forEach(t => console.log("    - " + t.name + " (" + t.role + ")"));
  }
  
  // 2. 测试"全部团队" API (公开团队)
  console.log("\n=== 测试 2: 全部公开团队 ===");
  const publicTeams = await prisma.team.findMany({
    where: { isPublic: true },
    select: { name: true, ownerType: true }
  });
  
  console.log("公开团队数: " + publicTeams.length);
  
  const publicStats = { teacher: 0, student: 0 };
  publicTeams.forEach(t => publicStats[t.ownerType]++);
  console.log("  - 教师创建: " + publicStats.teacher);
  console.log("  - 学生创建: " + publicStats.student);
  
  // 3. 检查学生独立团队是否在正确的列表中
  console.log("\n=== 测试 3: \"学生独立团队\" 检查 ===");
  const studentIndependentTeams = await prisma.team.findMany({
    where: { name: { contains: "学生独立团队" } },
    include: { members: { where: { userType: "teacher" } } }
  });
  
  console.log("学生独立团队数: " + studentIndependentTeams.length);
  
  let correctCount = 0;
  let incorrectCount = 0;
  
  studentIndependentTeams.forEach(t => {
    const hasTeacher = t.members.length > 0;
    if (hasTeacher) {
      incorrectCount++;
      console.log("  ⚠️ " + t.name + ": 有教师成员 (不应该!)");
    } else {
      correctCount++;
    }
  });
  
  console.log("\n  ✓ 正确 (无教师成员): " + correctCount);
  if (incorrectCount > 0) {
    console.log("  ⚠️ 错误 (有教师成员): " + incorrectCount);
  }
  
  // 4. 检查学生创建-教师管理的团队
  console.log("\n=== 测试 4: \"学生创建-教师管理\" 检查 ===");
  const studentTeacherTeams = await prisma.team.findMany({
    where: { name: { contains: "学生创建-教师管理" } },
    include: { members: true }
  });
  
  console.log("团队数: " + studentTeacherTeams.length);
  
  studentTeacherTeams.forEach(t => {
    const teacherAdmins = t.members.filter(m => m.userType === "teacher" && m.role === "admin");
    const teacherOwners = t.members.filter(m => m.userType === "teacher" && m.role === "owner");
    
    if (teacherOwners.length > 0) {
      console.log("  ⚠️ " + t.name + ": 教师是所有者 (不应该!)");
    } else if (teacherAdmins.length > 0) {
      console.log("  ✓ " + t.name + ": 教师是管理员");
    } else {
      console.log("  ⚠️ " + t.name + ": 无教师管理员");
    }
  });
  
  // 5. 总结
  console.log("\n========================================");
  console.log("     测试总结");
  console.log("========================================");
  console.log("");
  console.log("✓ 我的团队: 张老师是 " + myMemberships.length + " 个团队的成员");
  console.log("  - 其中 " + studentOwnedInMine.length + " 个是学生创建的团队 (作为管理员)");
  console.log("");
  console.log("✓ 全部团队: " + publicTeams.length + " 个公开团队");
  console.log("  - 学生创建的公开团队应该出现在这里");
  console.log("");
  console.log("⚠️ 如果前端\"我的团队\"Tab 显示了\"学生独立团队\"");
  console.log("   那是前端问题，不是后端问题");
  
  await prisma.$disconnect();
}

test();
