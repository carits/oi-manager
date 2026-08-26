---
status: reference
audience: development, testing
last_verified: 2026-08-26
source_of_truth: apps/web/src/app and e2e/fixtures/routes.ts
---

# HTTP 接口清单

本清单由服务端路由扫描生成。校园业务必须带组织 URL 与有效成员关系；旧学生、教师、学校端点仅作为退役入口，不再承载业务。

`pnpm api:auth-audit` 会把本清单中的全部端点与 Express 路由声明、路由挂载认证和
`scripts/api-public-endpoints.json` 对照。当前 317 个端点中 309 个必须认证，8 个允许匿名访问；
任何新增匿名端点都必须登记最小公开理由，否则 `pnpm docs:check` 失败。该门禁只证明认证边界，
本人、同组织、跨组织及各管理员的资源级授权继续由权限矩阵测试证明。
`pnpm api:anonymous-audit` 会向运行中的 API 实际发送 317 个无会话请求：309 个受保护端点必须返回
401，8 个公开端点必须返回非鉴权、非 5xx 响应。参数统一替换为不存在的审计 ID，写请求使用空对象，
用于验证认证中间件必须先于业务写入执行。

| 方法 | 路径 | 说明 |
|---|---|---|
| `GET` | `/api/problems/:id/hack-config` | 题目管理者读取 ACM/OI Hack 配置 |
| `PUT` | `/api/problems/:id/hack-config` | 编译检查并保存 STD、Validator、Classifier 和 Hack 开关 |
| `GET` | `/api/problems/:id/hacks` | 查看自己的 Hack 记录；题目管理者查看全部 |
| `POST` | `/api/problems/:id/hacks` | 以直接数据或生成器发起题目级 Hack |
| `GET` | `/api/problems/:id/hacks/:hackId` | 查看有权限的 Hack 详情 |
| `POST` | `/api/problems/:id/hacks/:hackId/retry` | 题目管理者重新执行系统错误任务 |
| `GET` | `/api/problems/:id/test-graph` | 题目管理者读取规范化 OI 测试图和迁移检查结果 |
| `PUT` | `/api/problems/:id/test-graph` | 校验并保存 Subtask/Group/Testcase 测试图 |
| `POST` | `/api/problems/:id/test-graph/migrate` | 题目管理者显式检查并幂等迁移单题旧 OI 配置 |
| `POST` | `/api/problems/:id/test-graph/testcases` | 将当前题目的输入与答案文件配对注册为稳定 Testcase |
| `GET` | `/api/problems/:id/test-set-revisions` | 题目管理者列出正式测试版本历史 |
| `GET` | `/api/problems/:id/test-set-revisions/:revisionId` | 读取单个不可变 Revision 和只读 Judge 投影 |
| `POST` | `/api/problems/:id/judge-mode-transition` | 显式创建 ACM/OI 模式转换 Revision 并关闭 Hack |
| `GET` | `/api/admin/problem-test-graph/migration` | 超级管理员检查旧 OI 配置迁移条件 |
| `POST` | `/api/admin/problem-test-graph/migration` | 超级管理员通过 API 幂等迁移合法题目 |
| `GET` | `/api/admin/problem-test-set-revisions/migration` | 超级管理员检查历史题目和活动快照能否安全固定 Revision |
| `POST` | `/api/admin/problem-test-set-revisions/migration` | 超级管理员通过 API 幂等生成 Revision 并固定活动/提交 |
| `GET` | `/api/trainings/:id/problems/:trainingProblemId/test-set-update` | 活动管理员比较固定 Revision 与题库最新版及冻结状态 |
| `POST` | `/api/trainings/:id/problems/:trainingProblemId/test-set-update` | 仅在未开始且无提交时手动固定到指定 Revision |
| `GET` | `/api/readiness` | 蓝绿 API 候选数据库与 Revision 投影 readiness |
| `DELETE` | `/api/problems/:id/statement-versions/:versionId` | 软删除自己的题面版本 |
| `GET` | `/api/problems/:id/statement-versions` | 列出官方、我的和公开题面版本 |
| `GET` | `/api/problems/:id/statement-versions/:versionId` | 读取可访问的个人题面版本 |
| `GET` | `/api/problems/:id/statement-versions/:versionId/file` | 读取个人 PDF 题面 |

Hack 列表接口仅返回状态、前后 Verdict、失败阶段等摘要字段。候选输入、生成器源码和被 Hack
程序只由单条详情接口返回，并继续执行“本人或题目管理者”权限校验。活动任务冲突时重新执行接口
返回 `409 HACK_ALREADY_ACTIVE`。
| `GET` | `/api/trainings/:id/problems/:trainingProblemId/statement-versions` | 读取活动当前可见题面快照集合 |
| `GET` | `/api/trainings/:id/problems/:trainingProblemId/statement-versions/:snapshotId/file` | 读取活动 PDF 题面快照 |
| `GET` | `/api/trainings/:id/statement-management` | 读取活动多题面管理矩阵 |
| `PATCH` | `/api/problems/:id/statement-versions/:versionId` | 重命名或切换个人题面可见性 |
| `POST` | `/api/problems/:id/statement-versions` | 从官方、用户版本或空白创建独立题面 |
| `POST` | `/api/problems/:id/statement-versions/:versionId/pdf` | 上传或替换个人 PDF 题面 |
| `POST` | `/api/trainings/:id/problems/:trainingProblemId/content-snapshots/:kind/:snapshotId/pdf` | 管理员替换活动 PDF 并创建新 revision |
| `PUT` | `/api/problems/:id/statement-versions/:versionId/content` | 更新个人 Markdown 题面内容 |
| `PUT` | `/api/trainings/:id/statement-management` | 保存活动多题面选择和唯一默认项 |
| `DELETE` | `/api/archived-problems` | 见对应路由实现 |
| `DELETE` | `/api/archived-problems/:id` | 见对应路由实现 |
| `DELETE` | `/api/files/:id` | 见对应路由实现 |
| `DELETE` | `/api/oj-accounts/:id` | 见对应路由实现 |
| `DELETE` | `/api/oj-fetcher/jobs/:id` | 见对应路由实现 |
| `DELETE` | `/api/organizations/:organizationId/members/students/:profileId` | 见对应路由实现 |
| `DELETE` | `/api/organizations/:organizationId/members/teachers/:profileId` | 见对应路由实现 |
| `DELETE` | `/api/platform-bindings/:platform` | 见对应路由实现 |
| `DELETE` | `/api/problem-lists/:id` | 见对应路由实现 |
| `DELETE` | `/api/problem-lists/:id/shares/:shareId` | 见对应路由实现 |
| `DELETE` | `/api/problem-lists/entries/:entryId` | 见对应路由实现 |
| `DELETE` | `/api/problem-lists/sections/:sectionId` | 见对应路由实现 |
| `DELETE` | `/api/problems/:id` | 见对应路由实现 |
| `DELETE` | `/api/problems/:id/attachments/:attachmentId` | 见对应路由实现 |
| `DELETE` | `/api/problems/:id/statements/:statementId` | 见对应路由实现 |
| `DELETE` | `/api/problems/:id/testdata/:fileId` | 见对应路由实现 |
| `DELETE` | `/api/teams/:id` | 见对应路由实现 |
| `DELETE` | `/api/teams/:id/admins/:adminId` | 见对应路由实现 |
| `DELETE` | `/api/teams/:id/invites/:inviteId` | 见对应路由实现 |
| `DELETE` | `/api/teams/:id/members/:memberId` | 见对应路由实现 |
| `DELETE` | `/api/teams/:teamId/problem-lists/:id` | 见对应路由实现 |
| `DELETE` | `/api/trainings/:id` | 见对应路由实现 |
| `DELETE` | `/api/trainings/:id/problems/:problemId` | 见对应路由实现 |
| `GET` | `/api/admin/data/submission-stats` | 见对应路由实现 |
| `GET` | `/api/archived-problems` | 见对应路由实现 |
| `GET` | `/api/archived-problems/:id` | 见对应路由实现 |
| `GET` | `/api/archived-problems/stats/summary` | 见对应路由实现 |
| `GET` | `/api/auth/me` | 见对应路由实现 |
| `GET` | `/api/carits/me` | 见对应路由实现 |
| `GET` | `/api/carits/me/transactions` | 见对应路由实现 |
| `GET` | `/api/carits/organizations/:organizationId` | 见对应路由实现 |
| `GET` | `/api/carits/organizations/:organizationId/transactions` | 见对应路由实现 |
| `GET` | `/api/carits/platform` | 见对应路由实现 |
| `GET` | `/api/contributions/me/events` | 见对应路由实现 |
| `GET` | `/api/contributions/me/summary` | 见对应路由实现 |
| `GET` | `/api/contributions/organizations/:organizationId/events` | 见对应路由实现 |
| `GET` | `/api/contributions/organizations/:organizationId/rankings` | 见对应路由实现 |
| `GET` | `/api/contributions/platform` | 见对应路由实现 |
| `GET` | `/api/contributions/rankings/users` | 见对应路由实现 |
| `GET` | `/api/files/:id` | 见对应路由实现 |
| `GET` | `/api/files/:id/download` | 见对应路由实现 |
| `GET` | `/api/files/:id/public` | 见对应路由实现 |
| `GET` | `/api/files/by-owner/:ownerType/:ownerId` | 见对应路由实现 |
| `GET` | `/api/health` | 见对应路由实现 |
| `GET` | `/api/me/contests` | 见对应路由实现 |
| `GET` | `/api/me/homeworks` | 见对应路由实现 |
| `GET` | `/api/me/overview` | 见对应路由实现 |
| `GET` | `/api/notifications` | 见对应路由实现 |
| `GET` | `/api/oj-accounts` | 见对应路由实现 |
| `GET` | `/api/oj-accounts/stats` | 见对应路由实现 |
| `GET` | `/api/oj-fetcher/:platform/:problemId` | 见对应路由实现 |
| `GET` | `/api/oj-fetcher/jobs` | 见对应路由实现 |
| `GET` | `/api/oj-fetcher/platforms` | 见对应路由实现 |
| `GET` | `/api/oj-fetcher/platforms/:platform/config` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/activities/contests` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/activities/homeworks` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/campus` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/students` | 见对应路由实现 |
| `GET` | `/api/organizations/:organizationId/members/teachers` | 见对应路由实现 |
| `GET` | `/api/platform-bindings` | 见对应路由实现 |
| `GET` | `/api/platform-bindings/:platform` | 见对应路由实现 |
| `GET` | `/api/platform-bindings/:platform/config-schema` | 见对应路由实现 |
| `GET` | `/api/platform-bindings/platforms` | 见对应路由实现 |
| `GET` | `/api/platform/organizations` | 见对应路由实现 |
| `GET` | `/api/platform/organizations/:organizationId` | 见对应路由实现 |
| `GET` | `/api/platform/organizations/:organizationId/students` | 见对应路由实现 |
| `GET` | `/api/platform/organizations/:organizationId/teachers` | 见对应路由实现 |
| `GET` | `/api/problem-lists` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id/entries/:entryId/files/:fileId` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id/entries/:entryId/problem` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id/share-candidates` | 见对应路由实现 |
| `GET` | `/api/problem-lists/:id/shares` | 见对应路由实现 |
| `GET` | `/api/problems` | 见对应路由实现 |
| `GET` | `/api/problems/:id` | 见对应路由实现 |
| `GET` | `/api/problems/:id/ai/usage` | 见对应路由实现 |
| `GET` | `/api/problems/:id/attachments` | 见对应路由实现 |
| `GET` | `/api/problems/:id/judge-config` | 见对应路由实现 |
| `GET` | `/api/problems/:id/note` | 见对应路由实现 |
| `GET` | `/api/problems/:id/submissions` | 见对应路由实现 |
| `GET` | `/api/problems/:id/testdata` | 见对应路由实现 |
| `GET` | `/api/problems/:id/testdata/download/:filename` | 见对应路由实现 |
| `GET` | `/api/problems/:id/testdata/export` | 见对应路由实现 |
| `GET` | `/api/problems/:id/testdata/files/:fileId/download` | 见对应路由实现 |
| `GET` | `/api/problems/library/creators` | 见对应路由实现 |
| `GET` | `/api/rankings/organizations/:organizationId/:metric` | 见对应路由实现 |
| `GET` | `/api/rankings/personal/rating` | 见对应路由实现 |
| `GET` | `/api/rankings/personal/solved` | 见对应路由实现 |
| `GET` | `/api/stats/global` | 见对应路由实现 |
| `GET` | `/api/stats/schools` | 见对应路由实现 |
| `GET` | `/api/submissions` | 见对应路由实现 |
| `GET` | `/api/submissions/:id` | 见对应路由实现 |
| `GET` | `/api/team-import/:batchId/preview` | 见对应路由实现 |
| `GET` | `/api/team-import/:batchId/result` | 见对应路由实现 |
| `GET` | `/api/team-import/history/:teamId` | 见对应路由实现 |
| `GET` | `/api/team-import/luogu/groups` | 见对应路由实现 |
| `GET` | `/api/team-import/platforms` | 见对应路由实现 |
| `GET` | `/api/team-import/teams` | 见对应路由实现 |
| `GET` | `/api/team-import/vjudge/groups` | 见对应路由实现 |
| `GET` | `/api/teams` | 见对应路由实现 |
| `GET` | `/api/teams/:id` | 见对应路由实现 |
| `GET` | `/api/teams/:id/admins` | 见对应路由实现 |
| `GET` | `/api/teams/:id/available-members` | 见对应路由实现 |
| `GET` | `/api/teams/:id/join-requests` | 见对应路由实现 |
| `GET` | `/api/teams/:id/pending-invites` | 见对应路由实现 |
| `GET` | `/api/teams/:teamId/problem-lists` | 见对应路由实现 |
| `GET` | `/api/teams/:teamId/trainings` | 见对应路由实现 |
| `GET` | `/api/teams/admin-invitations` | 见对应路由实现 |
| `GET` | `/api/teams/check-team-id` | 见对应路由实现 |
| `GET` | `/api/teams/invitations` | 见对应路由实现 |
| `GET` | `/api/teams/member-invitations` | 见对应路由实现 |
| `GET` | `/api/teams/mine` | 见对应路由实现 |
| `GET` | `/api/teams/my-admin-teams` | 见对应路由实现 |
| `GET` | `/api/teams/my-member-teams` | 见对应路由实现 |
| `GET` | `/api/teams/organization/:organizationId` | 见对应路由实现 |
| `GET` | `/api/trainings/:id` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/attachments` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/overview` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/problem-status` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/problems` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/problems/:problemId/attachments` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/problems/:problemId/detail` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/problems/:problemId/files/:fileId` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/problems/:problemId/note` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/problems/:problemId/solution` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/ranking` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/record` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/solutions` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/submissions` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/submissions/:submissionId` | 见对应路由实现 |
| `GET` | `/api/users` | 见对应路由实现 |
| `GET` | `/api/users/:id` | 见对应路由实现 |
| `GET` | `/api/users/:userId/profile` | 见对应路由实现 |
| `GET` | `/api/workspaces` | 见对应路由实现 |
| `PATCH` | `/api/notifications/:id/read` | 见对应路由实现 |
| `POST` | `/api/admin/data/backfill-training-participants` | 见对应路由实现 |
| `POST` | `/api/admin/data/clean-training-submissions` | 见对应路由实现 |
| `POST` | `/api/admin/data/fix-carits-remote-id` | 见对应路由实现 |
| `POST` | `/api/admin/data/fix-hdu-memory` | 见对应路由实现 |
| `POST` | `/api/admin/data/fix-submission-visibility` | 见对应路由实现 |
| `POST` | `/api/admin/data/reset-user-password` | 见对应路由实现 |
| `POST` | `/api/admin/data/rejudge-all-carits` | 见对应路由实现 |
| `POST` | `/api/admin/data/rejudge-all-local` | 重测所有已完成的本地评测提交（兼容任意题目来源） |
| `POST` | `/api/admin/data/rejudge-legacy-carits` | 见对应路由实现 |
| `POST` | `/api/admin/demo-scenario/v2/events` | 见对应路由实现 |
| `POST` | `/api/admin/demo-scenario/v2/prepare` | 见对应路由实现 |
| `POST` | `/api/admin/demo-scenario/v3/events` | 见对应路由实现 |
| `POST` | `/api/admin/demo-scenario/v3/prepare` | 见对应路由实现 |
| `POST` | `/api/admin/migration/migrate-problem-status` | 见对应路由实现 |
| `POST` | `/api/admin/migration/migrate-submission-scope` | 见对应路由实现 |
| `POST` | `/api/archived-problems` | 见对应路由实现 |
| `POST` | `/api/auth/avatar` | 见对应路由实现 |
| `POST` | `/api/auth/login` | 见对应路由实现 |
| `POST` | `/api/auth/logout` | 见对应路由实现 |
| `POST` | `/api/auth/register` | 见对应路由实现 |
| `POST` | `/api/auth/session/migrate` | 见对应路由实现 |
| `POST` | `/api/auth/switch-workspace` | 见对应路由实现 |
| `POST` | `/api/files/upload` | 见对应路由实现 |
| `POST` | `/api/notifications/read-all` | 见对应路由实现 |
| `POST` | `/api/oj-accounts` | 见对应路由实现 |
| `POST` | `/api/oj-accounts/:id/login` | 见对应路由实现 |
| `POST` | `/api/oj-accounts/:id/verify` | 见对应路由实现 |
| `POST` | `/api/oj-accounts/batch-verify` | 见对应路由实现 |
| `POST` | `/api/oj-fetcher/download-attachment` | 见对应路由实现 |
| `POST` | `/api/oj-fetcher/jobs/:id/retry` | 见对应路由实现 |
| `POST` | `/api/oj-fetcher/jobs/batch` | 见对应路由实现 |
| `POST` | `/api/organizations/:organizationId/members/activities/contests` | 见对应路由实现 |
| `POST` | `/api/organizations/:organizationId/members/principal-transfer` | 见对应路由实现 |
| `POST` | `/api/organizations/:organizationId/members/students` | 见对应路由实现 |
| `POST` | `/api/organizations/:organizationId/members/teachers` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/:platform/bind` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/:platform/refresh` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/admin/cleanup-submissions` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/codeforces/sync-archive` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/codeforces/sync-submissions` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/luogu/sync-archive` | 见对应路由实现 |
| `POST` | `/api/platform-bindings/luogu/sync-submissions` | 见对应路由实现 |
| `POST` | `/api/platform/organizations` | 见对应路由实现 |
| `POST` | `/api/platform/organizations/:organizationId/principal` | 见对应路由实现 |
| `POST` | `/api/problem-lists` | 见对应路由实现 |
| `POST` | `/api/problem-lists/:id/entries/resolve` | 见对应路由实现 |
| `POST` | `/api/problem-lists/:id/publish-homework` | 见对应路由实现 |
| `POST` | `/api/problem-lists/:id/sections` | 见对应路由实现 |
| `POST` | `/api/problem-lists/:id/shares` | 见对应路由实现 |
| `POST` | `/api/problem-lists/sections/:sectionId/entries/single` | 见对应路由实现 |
| `POST` | `/api/problems` | 见对应路由实现 |
| `POST` | `/api/problems/:id/ai/format` | 见对应路由实现 |
| `POST` | `/api/problems/:id/ai/translate` | 见对应路由实现 |
| `POST` | `/api/problems/:id/attachments` | 见对应路由实现 |
| `POST` | `/api/problems/:id/copy-to-school` | 见对应路由实现 |
| `POST` | `/api/problems/:id/solution-pdf` | 见对应路由实现 |
| `POST` | `/api/problems/:id/statement-pdf` | 见对应路由实现 |
| `POST` | `/api/problems/:id/statements/pdf` | 见对应路由实现 |
| `POST` | `/api/problems/:id/testdata` | 见对应路由实现 |
| `POST` | `/api/problems/:id/testdata/auto` | 见对应路由实现 |
| `POST` | `/api/resolve-problems` | 见对应路由实现 |
| `POST` | `/api/submissions/:id/refetch-code` | 见对应路由实现 |
| `POST` | `/api/submit` | 见对应路由实现 |
| `POST` | `/api/submit/rejudge` | 见对应路由实现 |
| `POST` | `/api/team-import/:batchId/confirm` | 见对应路由实现 |
| `POST` | `/api/team-import/luogu/import` | 见对应路由实现 |
| `POST` | `/api/team-import/luogu/preview` | 见对应路由实现 |
| `POST` | `/api/team-import/luogu/validate` | 见对应路由实现 |
| `POST` | `/api/team-import/start` | 见对应路由实现 |
| `POST` | `/api/team-import/vjudge/import` | 见对应路由实现 |
| `POST` | `/api/team-import/vjudge/preview` | 见对应路由实现 |
| `POST` | `/api/team-import/vjudge/validate` | 见对应路由实现 |
| `POST` | `/api/teams` | 见对应路由实现 |
| `POST` | `/api/teams/:id/admins` | 见对应路由实现 |
| `POST` | `/api/teams/:id/avatar` | 见对应路由实现 |
| `POST` | `/api/teams/:id/join-request` | 见对应路由实现 |
| `POST` | `/api/teams/:id/leave` | 见对应路由实现 |
| `POST` | `/api/teams/:id/members` | 见对应路由实现 |
| `POST` | `/api/teams/:id/transfer` | 见对应路由实现 |
| `POST` | `/api/teams/:teamId/problem-lists` | 见对应路由实现 |
| `POST` | `/api/teams/:teamId/trainings` | 见对应路由实现 |
| `POST` | `/api/teams/admin-invitations/:invitationId/accept` | 见对应路由实现 |
| `POST` | `/api/teams/admin-invitations/:invitationId/reject` | 见对应路由实现 |
| `POST` | `/api/teams/invitations/:invitationId/accept` | 见对应路由实现 |
| `POST` | `/api/teams/invitations/:invitationId/reject` | 见对应路由实现 |
| `POST` | `/api/teams/join-requests/:requestId/approve` | 见对应路由实现 |
| `POST` | `/api/teams/join-requests/:requestId/reject` | 见对应路由实现 |
| `POST` | `/api/teams/member-invitations/:invitationId/accept` | 见对应路由实现 |
| `POST` | `/api/teams/member-invitations/:invitationId/reject` | 见对应路由实现 |
| `POST` | `/api/trainings/:id/create-makeup-homework` | 见对应路由实现 |
| `POST` | `/api/trainings/:id/finish` | 见对应路由实现 |
| `POST` | `/api/trainings/:id/problems` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/rejudge/preview` | 见对应路由实现 |
| `GET` | `/api/trainings/:id/submission-users` | 见对应路由实现 |
| `POST` | `/api/trainings/:id/rejudge` | 见对应路由实现 |
| `POST` | `/api/trainings/:id/start` | 见对应路由实现 |
| `POST` | `/api/trainings/:id/submit` | 见对应路由实现 |
| `POST` | `/api/users/:id/reset-password` | 见对应路由实现 |
| `POST` | `/api/users/platform-admin` | 见对应路由实现 |
| `POST` | `/api/workspaces/organization-invitations/:id/:action` | 见对应路由实现 |
| `POST` | `/api/workspaces/organizations/:id/invitations` | 见对应路由实现 |
| `PUT` | `/api/archived-problems/:id` | 见对应路由实现 |
| `PUT` | `/api/auth/password` | 见对应路由实现 |
| `PUT` | `/api/auth/profile` | 见对应路由实现 |
| `PUT` | `/api/oj-accounts/:id` | 见对应路由实现 |
| `PUT` | `/api/oj-fetcher/platforms/:platform/config` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/campus` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/campus/announcement` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/students/:profileId` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/students/:profileId/status` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/teachers/:profileId` | 见对应路由实现 |
| `PUT` | `/api/organizations/:organizationId/members/teachers/:profileId/status` | 见对应路由实现 |
| `PUT` | `/api/platform/organizations/:organizationId` | 见对应路由实现 |
| `PUT` | `/api/platform/organizations/:organizationId/principal` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/:id` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/:id/sections/reorder` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/entries/:entryId` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/sections/:sectionId` | 见对应路由实现 |
| `PUT` | `/api/problem-lists/sections/:sectionId/entries/reorder` | 见对应路由实现 |
| `PUT` | `/api/problems/:id` | 见对应路由实现 |
| `PUT` | `/api/problems/:id/judge-config` | 见对应路由实现 |
| `PUT` | `/api/problems/:id/note` | 见对应路由实现 |
| `PUT` | `/api/problems/:id/statements/:statementId/visibility` | 见对应路由实现 |
| `PUT` | `/api/teams/:id` | 见对应路由实现 |
| `PUT` | `/api/teams/:id/announcement` | 见对应路由实现 |
| `PUT` | `/api/trainings/:id` | 见对应路由实现 |
| `PUT` | `/api/trainings/:id/end-time` | 见对应路由实现 |
| `PUT` | `/api/trainings/:id/problems/:problemId` | 见对应路由实现 |
| `PUT` | `/api/trainings/:id/problems/:problemId/note` | 见对应路由实现 |
| `PUT` | `/api/trainings/:id/problems/reorder` | 见对应路由实现 |
| `PUT` | `/api/trainings/:id/record` | 见对应路由实现 |
| `PUT` | `/api/users/:id/status` | 见对应路由实现 |
| `GET` | `/api/problems/:id/checker` | 题目 Checker 文件列表 |
| `GET` | `/api/problems/:id/checker/:fileName/download` | 下载 Checker 源码 |
| `POST` | `/api/problems/:id/checker` | 上传 Checker 源码 |
| `DELETE` | `/api/problems/:id/checker/:checkerId` | 删除 Checker 源码 |
| `GET` | `/api/problems/:id/my-content` | 获取自己的题面、题解及可共享校园 |
| `GET` | `/api/problems/:id/content-options` | 获取创建活动时可选用的题面与题解 |
| `PUT` | `/api/problems/:id/my-content/:kind` | 保存自己的 Markdown 题面或题解 |
| `PUT` | `/api/problems/:id/my-content/:kind/shares` | 设置个人内容的平台/校园共享范围 |
| `POST` | `/api/problems/:id/my-content/:kind/pdf` | 上传自己的 PDF 题面或题解 |
| `DELETE` | `/api/problems/:id/my-content/:kind` | 删除自己的当前版本；既有活动快照不受影响 |
| `GET` | `/api/trainings/:id/problems/:trainingProblemId/my-content` | 从活动上下文读取自己的版本 |
| `PUT` | `/api/trainings/:id/problems/:trainingProblemId/content-snapshots/:kind/:snapshotId` | 管理员编辑活动 Markdown 并创建新 revision |
| `GET` | `/api/trainings/:id/problems/:trainingProblemId/content-options` | 管理员获取活动可选内容与当前快照 |
| `GET` | `/api/trainings/:id/problems/:trainingProblemId/content-options/:optionKey/preview` | 管理员预览候选内容 |
| `GET` | `/api/trainings/:id/problems/:trainingProblemId/content-options/:optionKey/file` | 管理员预览候选 PDF |
| `PUT` | `/api/trainings/:id/problems/:trainingProblemId/content-selection` | 选择活动题面与题解并追加不可变快照 |
| `GET` | `/api/trainings/:id/problems/:trainingProblemId/content-snapshot/:kind/file` | 读取活动当前 PDF 快照 |
