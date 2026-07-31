---
status: archived
audience: historical
last_verified: 2026-07-30
source_of_truth: historical snapshot
replacement: docs/STATUS.md
---

> 历史文档：本文件保留当时的设计、调查或实现记录，不代表当前系统行为。请以 `docs/STATUS.md` 为准。

# 当前任务

## 任务：个人模式入口与模式切换（修订版 — 登录后切换）

状态: **已完成** ✅

### 需求（用户修正）

学生可以在校园模式和个人模式之间切换：
1. **登录页不选择模式** — 登录页保持 3 个按钮（教师端/学生端/管理员端）
2. **登录后在 App 内切换模式** — 模式切换是 App 内操作，不需要退出重登
3. **切换入口要明显** — 在导航栏右侧放置显眼的胶囊形切换按钮

用户原话："你的登录界面进行修改了 我要求的是登录之后可以选择 而且切换模式的地方要明显不是退出登录再重新进来"

### 关键设计决策

- **模式存储在 JWT 中**：`studentMode: 'campus' | 'personal'`，是会话级概念
- **schoolId 不变**：校园模式和个人模式的 schoolId 相同，学校只是组织单位
- **校园模式学生**：不能创建团队/题单（后端 403）
- **个人模式学生**：可以创建团队/题单
- **切换模式不退出登录**：后端新增 `POST /api/auth/switch-mode` 端点刷新 JWT

### 导航差异

| 模式 | 导航 |
|------|------|
| 校园模式 | 团队 \| 作业 \| 比赛 \| 题单 \| 排名 |
| 个人模式 | 我的团队 \| 题库 \| 比赛 \| 题单 \| 评测记录 \| 排名 |

### 修改文件（修订版核心改动）

| 文件 | 改动 |
|------|------|
| `apps/server/src/routes/auth.ts` | 新增 `POST /api/auth/switch-mode` 端点（仅刷新 JWT studentMode） |
| `apps/web/src/components/AuthProvider.tsx` | 新增 `switchMode()` 方法，暴露到 AuthContext |
| `apps/web/src/components/AppShell.tsx` | 删除退出弹窗，新增显眼胶囊形模式切换按钮（仅学生可见） |
| `apps/web/src/app/login/page.tsx` | 回复 3 按钮（教师/学生/管理员），学生默认上次模式 |

### 之前已完成的基础工作（保留）

| 文件 | 已有改动 |
|------|------|
| `packages/shared/src/index.ts` | JwtPayload/LoginResponse 新增 `studentMode` |
| `apps/server/src/routes/auth.ts` | 登录接受 `mode`，`/me` 返回 `studentMode`，注册 schoolId 可选 |
| `apps/server/src/middleware/auth.ts` | `isPersonalMode()` 工具函数 |
| `apps/web/src/lib/auth.ts` | getStudentMode/setStudentMode/getLastStudentMode/setLastStudentMode |
| `apps/web/src/config/navigation.ts` | `studentPersonalNav` + `getNavConfig(role, studentMode)` |
| `apps/server/src/modules/team/team.crud.routes.ts` | 个人模式学生放行 POST |
| `apps/server/src/routes/problem-lists.ts` | 个人模式学生放行 POST/PUT/DELETE |
| `apps/server/src/routes/team-problem-lists.ts` | 个人模式学生放行 POST/DELETE |
| `apps/server/prisma/seed.ts` | `personal_student1` 测试账号 |
| `apps/web/src/app/student/page.tsx` | 根据 studentMode 显示不同快捷入口 |
| `apps/web/src/app/student/team/page.tsx` | showCreateButton 根据 studentMode 决定 |
| `apps/web/src/app/student/problem-lists/page.tsx` | canCreate 根据 studentMode 决定 |

### 验证

- ✅ 439 vitest 测试全部通过
- ✅ 登录页 3 个按钮（教师端/学生端/管理员端）
- ✅ 学生登录默认进入上次模式（lastStudentMode）
- ✅ AppShell 显眼位置（导航栏右侧）胶囊形模式切换按钮
- ✅ 点击切换按钮，JWT studentMode 刷新，导航和首页内容同步更新
- ✅ 退出登录直接退出（无弹窗），所有角色一致
- ✅ JWT payload 包含 studentMode 字段
- ✅ 后端 `POST /api/auth/switch-mode` 端点（仅学生角色可用）
- ✅ 后端 `isPersonalMode()` 工具函数
- ✅ 个人模式学生导航：我的团队 | 题库 | 比赛 | 题单 | 评测记录 | 排名
- ✅ 校园学生导航：团队 | 作业 | 比赛 | 题单 | 排名

### 手工验收清单

- [ ] 登录页 3 个按钮（教师/学生/管理员），无模式拆分
- [ ] 学生登录默认上次模式（首次为校园模式）
- [ ] AppShell 右侧显示胶囊形模式切换按钮（仅学生可见）
- [ ] 校园模式按钮显示"校园模式 · 切换到个人"
- [ ] 个人模式按钮显示"个人模式 · 切换到校园"
- [ ] 点击切换按钮，模式立即切换，导航同步更新
- [ ] 切换不退出登录
- [ ] 校园模式下学生不能创建团队、题单（后端 403）
- [ ] 个人模式下学生可以创建团队、题单
- [ ] 退出登录直接退出（无弹窗）
- [ ] `personal_student1` / `123456` 可登录，默认上次模式
