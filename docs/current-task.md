# 当前任务

## 任务：学校题单 & 团队题单功能（2026-04-08）

状态: 已完成

### 完成内容

1. **Prisma Schema 变更**: 新增 `SchoolProblemList` 和 `TeamProblemList` 模型
   - School、Team、ProblemList 模型添加关联字段
   - `prisma db push` 已执行，数据库已同步

2. **后端 API**（6 个新端点）:
   - `GET /api/schools/:schoolId/problem-lists` — 获取学校题单列表
   - `POST /api/schools/:schoolId/problem-lists` — 添加题单到学校
   - `DELETE /api/schools/:schoolId/problem-lists/:id` — 移除学校题单
   - `GET /api/teams/:teamId/problem-lists` — 获取团队题单列表
   - `POST /api/teams/:teamId/problem-lists` — 添加题单到团队
   - `DELETE /api/teams/:teamId/problem-lists/:id` — 移除团队题单

3. **前端**:
   - 学校页面新增「题单库」tab（`ProblemListsTab` 组件）
   - 团队详情页「题单」tab 替换占位为真实功能（`TeamProblemListsTab` 组件）
   - 添加题单弹窗：列出自己 owner 的题单，已添加灰显

4. **测试**: 20 个新测试全部通过（学校题单 10 + 团队题单 10）

5. **权限规则**:
   - 学校：负责人和教师可添加（只能添加自己是 owner 的），负责人可删所有，教师只能删自己添加的
   - 团队：owner/admin/教师成员可添加，owner 可删所有，admin 只能删自己添加的

### 涉及文件
- `apps/server/prisma/schema.prisma` — 新增模型
- `apps/server/src/routes/school-problem-lists.ts` — 新建
- `apps/server/src/routes/team-problem-lists.ts` — 新建
- `apps/server/src/index.ts` — 注册路由
- `apps/server/tests/setup.ts` — 清理列表新增两个表
- `apps/server/tests/helpers/testRequest.ts` — 测试应用注册新路由
- `apps/server/tests/helpers/testUser.ts` — createTestTeam 添加 id 生成
- `apps/server/tests/school-team-problem-lists.test.ts` — 新建测试
- `apps/web/src/app/teacher/school/page.tsx` — 新增题单库 tab
- `apps/web/src/app/teacher/school/components/ProblemListsTab.tsx` — 新建
- `apps/web/src/components/team/TeamProblemListsTab.tsx` — 新建
- `apps/web/src/components/team/TeamDetailPage.tsx` — 替换占位为真实组件
