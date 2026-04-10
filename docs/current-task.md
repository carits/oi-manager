# 当前任务

## 任务：HDU 提交登录控制优化（2026-04-10）

状态: 已完成

### 完成内容

1. **Bug 修复**: HDU 提交返回 403 错误
   - 根因：登录成功后 Cookie 未保存到数据库
   - 修复：`hdu-submit.ts` 登录成功后同时保存 `cookie` 和 `cookieRaw`

2. **登录控制逻辑**: 实现 Cookie 复用，避免频繁登录
   - 判断是否需要续登：`elapsed >= (cookieValidMinutes - renewLoginThresholdMinutes)`
   - 默认配置：Cookie 有效 3600 分钟，提前 10 分钟续登
   - 实际续登时机：登录后约 59.8 小时

3. **失败冷却机制**:
   - 登录失败后进入 15 分钟冷却期
   - 连续失败 3 次后账号冻结（状态变为 `error`）

4. **累计统计**:
   - `totalSubmissions` — 累计提交次数（只增不减）
   - `totalSubmissionErrors` — 累计提交失败次数（只增不减）

5. **前端更新**:
   - OJ 账号管理页面："最后验证" → "最后登录"
   - 提交统计柱状图显示累计提交/失败数

6. **文档更新**:
   - `docs/oj-submit/README.md` — 通用登录控制设计（可复用到其他平台）
   - `docs/oj-submit/hdu.md` — HDU 具体实现和注意事项

### 验证结果

- 账号：`carits`
- 题目：HDU 1000
- Run ID：40832719
- 结果：**Accepted**

### 涉及文件
- `apps/server/src/lib/hdu-submit.ts` — 登录控制逻辑
- `apps/server/prisma/schema.prisma` — OjAccount 模型字段
- `apps/server/src/routes/oj-accounts.ts` — API 调整
- `apps/web/src/app/platform-admin/oj-accounts/page.tsx` — 前端展示
- `docs/oj-submit/README.md` — 通用设计文档
- `docs/oj-submit/hdu.md` — HDU 实现文档
- `docs/change-log.md` — 变更记录

---

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
