const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

const BASE_URL = "http://localhost:3001/api";

async function login(username, password, role) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password, role })
  });
  const data = await res.json();
  return data.success ? data.data : null;
}

async function api(method, path, token, body = null) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`
    },
    body: body ? JSON.stringify(body) : null
  });
  return res.json();
}

async function test() {
  console.log("========================================");
  console.log("     团队操作全面测试");
  console.log("========================================\n");

  const teacher = await login("teacher", "123456", "teacher");
  const student1 = await login("student1", "123456", "student");
  const student2 = await login("student2", "123456", "student");

  if (!teacher || !student1 || !student2) {
    console.log("登录失败");
    return;
  }

  console.log("教师: 张老师");
  console.log("学生1: student1");
  console.log("学生2: student2");

  let pass = 0, fail = 0;

  // 测试1: 邀请成员
  console.log("\n=== 测试1: 邀请成员 ===");
  const teams = await api("GET", `/teams?teacherId=${teacher.teacherId}&view=mine&page=1&pageSize=1`, teacher.token);
  const teamId = teams.data?.list?.[0]?.id;

  if (teamId) {
    const inviteRes = await api("POST", `/teams/${teamId}/members`, teacher.token, {
      studentIds: [student2.studentId]
    });
    if (inviteRes.success) {
      console.log("  OK 邀请成员成功");
      pass++;
    } else {
      console.log("  FAIL 邀请失败:", inviteRes.message);
      fail++;
    }
  }

  // 测试2: 查看待处理邀请
  console.log("\n=== 测试2: 查看待处理邀请 ===");
  const invitesRes = await api("GET", "/teams/member-invitations", student2.token);
  if (invitesRes.success && invitesRes.data?.length > 0) {
    console.log("  OK 学生有待处理邀请:", invitesRes.data.length);
    pass++;

    // 测试3: 接受邀请
    console.log("\n=== 测试3: 接受邀请 ===");
    const invite = invitesRes.data[0];
    const acceptRes = await api("POST", `/teams/member-invitations/${invite.id}/accept`, student2.token);
    if (acceptRes.success) {
      console.log("  OK 接受邀请成功");
      pass++;
    } else {
      console.log("  FAIL 接受失败:", acceptRes.message);
      fail++;
    }
  } else {
    console.log("  无待处理邀请");
  }

  // 测试4: 添加管理员
  console.log("\n=== 测试4: 添加管理员 ===");
  const ownedTeams = await api("GET", `/teams?teacherId=${teacher.teacherId}&view=mine&page=1&pageSize=5`, teacher.token);
  const ownedTeam = ownedTeams.data?.list?.find(t => t.ownerType === "teacher");

  if (ownedTeam) {
    const addAdminRes = await api("POST", `/teams/${ownedTeam.id}/admins`, teacher.token, {
      memberId: student1.studentId,
      memberType: "student"
    });
    if (addAdminRes.success) {
      console.log("  OK 添加管理员成功");
      pass++;

      // 验证
      const detail = await api("GET", `/teams/${ownedTeam.id}`, teacher.token);
      const isAdmin = detail.data?.admins?.some(a => a.id === student1.studentId);
      if (isAdmin) {
        console.log("  OK 管理员在列表中");
        pass++;
      } else {
        console.log("  FAIL 管理员不在列表中");
        fail++;
      }

      // 测试5: 移出管理员
      console.log("\n=== 测试5: 移出管理员 ===");
      const removeRes = await api("DELETE", `/teams/${ownedTeam.id}/admins/${student1.studentId}?adminType=student`, teacher.token);
      if (removeRes.success) {
        console.log("  OK 移出管理员成功");
        pass++;
      } else {
        console.log("  FAIL 移出失败:", removeRes.message);
        fail++;
      }
    } else {
      console.log("  FAIL 添加失败:", addAdminRes.message);
      fail++;
    }
  }

  // 测试6: 转移所有权
  console.log("\n=== 测试6: 转移所有权 ===");
  const createRes = await api("POST", "/teams", teacher.token, {
    name: "测试转移团队",
    schoolId: "school-default"
  });

  if (createRes.success) {
    const newTeamId = createRes.data.id;
    console.log("  OK 创建测试团队");

    // 添加学生为成员
    await api("POST", `/teams/${newTeamId}/members`, teacher.token, {
      studentIds: [student1.studentId]
    });

    // 转移所有权
    const transferRes = await api("POST", `/teams/${newTeamId}/transfer`, teacher.token, {
      newOwnerId: student1.studentId,
      newOwnerType: "student"
    });

    if (transferRes.success) {
      console.log("  OK 转移所有权成功");
      pass++;

      // 验证
      const detail = await api("GET", `/teams/${newTeamId}`, teacher.token);
      if (detail.data?.owner?.id === student1.studentId) {
        console.log("  OK 所有权已转移");
        pass++;
      } else {
        console.log("  FAIL 所有权验证失败");
        fail++;
      }
    } else {
      console.log("  FAIL 转移失败:", transferRes.message);
      fail++;
    }
  }

  // 测试7: 申请加入
  console.log("\n=== 测试7: 申请加入公有团队 ===");
  const publicTeams = await api("GET", "/teams?schoolId=school-default&view=all&page=1&pageSize=5", student1.token);
  const publicTeam = publicTeams.data?.list?.find(t => t.isPublic);

  if (publicTeam) {
    const applyRes = await api("POST", `/teams/${publicTeam.id}/join-request`, student1.token, {
      message: "申请加入"
    });
    if (applyRes.success) {
      console.log("  OK 申请成功");
      pass++;
    } else {
      console.log("  INFO 申请结果:", applyRes.message);
    }
  }

  // 测试8: 权限检查
  console.log("\n=== 测试8: 权限检查 ===");
  const studentTeam = await prisma.team.findFirst({
    where: { name: { contains: "学生独立团队" } }
  });

  if (studentTeam) {
    const detailRes = await api("GET", `/teams/${studentTeam.id}`, teacher.token);
    if (studentTeam.isPublic && detailRes.success) {
      console.log("  OK 教师可查看公开学生团队");
      pass++;
    } else if (!studentTeam.isPublic && !detailRes.success) {
      console.log("  OK 教师无法查看私有学生团队");
      pass++;
    } else {
      console.log("  FAIL 权限检查异常");
      fail++;
    }
  }

  // 总结
  console.log("\n========================================");
  console.log("通过:", pass, "失败:", fail);
  console.log("========================================");

  await prisma.$disconnect();
}

test();
