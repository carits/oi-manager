---
status: reference
audience: development, testing
last_verified: 2026-09-19
source_of_truth: apps/web/src/app and e2e/fixtures/routes.ts
---

# 页面路由

本清单由实际页面生成并与 E2E 路由清单同步。组织页面统一使用组织路径，个人页面使用个人路径，平台页面使用平台路径。旧教师端和学生端页面已删除，不属于可访问路由。

| 路径 | 访问范围 | 用途 |
|---|---|---|
| `/` | 见页面权限布局 | 当前页面 |
| `/account/platform-bindings` | 见页面权限布局 | 当前页面 |
| `/account/notifications` | 已登录账号 | 完整消息中心 |
| `/account/messages` | 已登录账号 | 联系人、联系申请、黑名单和一对一私信；支持历史分页、归档与单方清空 |
| `/account/profile` | 见页面权限布局 | 当前页面 |
| `/account/security` | 见页面权限布局 | 当前页面 |
| `/account/wallet` | 见页面权限布局 | 当前页面 |
| `/admin` | 见页面权限布局 | 当前页面 |
| `/admin/blog-moderation` | 超级管理员 | 博客举报、内容处置与社区精选治理 |
| `/admin/knowledge` | 超级管理员 | 保留平台管理外壳的知识广场 |
| `/admin/knowledge/[id]` | 超级管理员 | 保留平台管理外壳的知识文章阅读页 |
| `/admin/chat-reports` | 超级管理员 | 私信举报审核 |
| `/admin/contests` | 超级管理员 | 平台比赛列表 |
| `/admin/contests/[id]` | 超级管理员 | 平台比赛详情 |
| `/admin/contests/[id]/statements` | 超级管理员 | 平台比赛题面管理 |
| `/admin/contributions` | 超级管理员 | 贡献审批、奖励冲正与经济账本审计 |
| `/platform-admin/chat-reports` | 平台管理员 | 私信举报审核 |
| `/admin/platform-bindings` | 见页面权限布局 | 当前页面 |
| `/admin/profile` | 见页面权限布局 | 当前页面 |
| `/admin/schools` | 见页面权限布局 | 当前页面 |
| `/admin/schools/[id]` | 见页面权限布局 | 当前页面 |
| `/admin/schools/[id]/edit` | 见页面权限布局 | 当前页面 |
| `/admin/schools/new` | 见页面权限布局 | 当前页面 |
| `/admin/security` | 见页面权限布局 | 当前页面 |
| `/admin/submissions` | 见页面权限布局 | 当前页面 |
| `/admin/submissions/[id]` | 见页面权限布局 | 当前页面 |
| `/admin/users` | 见页面权限布局 | 当前页面 |
| `/admin/users/[id]` | 见页面权限布局 | 当前页面 |
| `/admin/users/new-platform-admin` | 见页面权限布局 | 当前页面 |
| `/blog` | 公开；登录后增加 PLATFORM 内容 | 知识文章发现与搜索 |
| `/blog/[id]` | 按 PUBLIC/PLATFORM 可见范围 | 公开知识文章阅读页 |
| `/identity` | 见页面权限布局 | 当前页面 |
| `/login` | 见页面权限布局 | 当前页面 |
| `/org/[organizationId]/[module]` | 见页面权限布局 | 当前页面 |
| `/org/[organizationId]/[module]/[...segments]` | 见页面权限布局 | 当前页面 |
| `/personal` | 见页面权限布局 | 当前页面 |
| `/personal/blogs` | 已登录账号 | 本人知识文章、草稿与发布版本 |
| `/personal/blogs/[id]` | 按文章或版本可见范围 | 博客阅读、草稿编辑、版本历史和固定引用 |
| `/personal/blogs/new` | 已登录账号 | 新建知识文章草稿 |
| `/personal/blogs/series` | 已登录账号 | 系列创建、可见范围与文章顺序管理 |
| `/personal/knowledge` | 已登录普通账号 | 保留个人工作区外壳的知识广场 |
| `/personal/knowledge/[id]` | 已登录普通账号 | 保留个人工作区外壳的知识文章阅读页 |
| `/personal/organizations` | 普通账号个人空间 | 我的组织、申请和邀请 |
| `/personal/campus` | 见页面权限布局 | 当前页面 |
| `/personal/carits` | 见页面权限布局 | 当前页面 |
| `/personal/contests` | 见页面权限布局 | 当前页面 |
| `/personal/contests/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/contests/[id]/statements` | 活动管理员 | 活动多题面矩阵管理 |
| `/personal/contributions` | 见页面权限布局 | 当前页面 |
| `/personal/data-market` | 已登录账号 | 数据商品、质量证书、许可证购买与本人可管理授权 |
| `/personal/problem-lists` | 见页面权限布局 | 当前页面 |
| `/personal/problem-lists/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/problem-lists/[id]/edit` | 见页面权限布局 | 当前页面 |
| `/personal/problem-lists/new` | 见页面权限布局 | 当前页面 |
| `/personal/problems` | 见页面权限布局 | 当前页面 |
| `/personal/problems/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/problems/[id]/note` | 已登录个人账号 | 个人题目笔记 |
| `/personal/rankings` | 见页面权限布局 | 当前页面 |
| `/personal/submissions` | 见页面权限布局 | 当前页面 |
| `/personal/submissions/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/teams` | 见页面权限布局 | 当前页面 |
| `/personal/teams/[id]` | 见页面权限布局 | 当前页面 |
| `/personal/teams/[id]/contests/[cid]` | 见页面权限布局 | 当前页面 |
| `/personal/teams/[id]/contests/[cid]/statements` | 活动管理员 | 团队比赛题面矩阵管理 |
| `/personal/teams/[id]/contests/[cid]` | 见页面权限布局 | 当前页面 |
| `/personal/teams/[id]/contests/[cid]/statements` | 活动管理员 | 团队训练题面矩阵管理 |
| `/personal/training-sessions` | 已登录账号 | 独立教练训练列表 |
| `/personal/training-sessions/[id]` | 教练或训练学员 | 冻结 Stage 摘要、当前要求/历史进度、提交和 Runtime Intervention 工作台 |
| `/personal/training-sessions/[id]/design` | 团队管理员 | 尚未开始 Stage 的用途、规则、Stage 分组、题号添加和固定 Revision 设计器 |
| `/platform-admin` | 见页面权限布局 | 当前页面 |
| `/platform-admin/blog-moderation` | 平台管理员 | 博客举报、内容处置与社区精选治理 |
| `/platform-admin/knowledge` | 平台管理员 | 保留平台管理外壳的知识广场 |
| `/platform-admin/knowledge/[id]` | 平台管理员 | 保留平台管理外壳的知识文章阅读页 |
| `/platform-admin/contests` | 平台管理员 | 平台比赛列表 |
| `/platform-admin/contests/[id]` | 平台管理员 | 平台比赛详情 |
| `/platform-admin/contests/[id]/statements` | 平台管理员 | 平台比赛题面管理 |
| `/platform-admin/ai` | 平台管理员 | DeepSeek Token 总池、审计流水和人工调整 |
| `/platform-admin/carits` | 见页面权限布局 | 当前页面 |
| `/platform-admin/contributions` | 见页面权限布局 | 当前页面 |
| `/platform-admin/data-market` | 平台管理员 | 数据商品发布、质量事故与授权工作台 |
| `/platform-admin/oj-accounts` | 见页面权限布局 | 当前页面 |
| `/platform-admin/platform-bindings` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems/[id]` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems/[id]/edit` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems/[id]/note` | 见页面权限布局 | 当前页面 |
| `/platform-admin/problems/new` | 见页面权限布局 | 当前页面 |
| `/platform-admin/submissions` | 见页面权限布局 | 当前页面 |
| `/platform-admin/submissions/[id]` | 见页面权限布局 | 当前页面 |
| `/platform-admin/users` | 见页面权限布局 | 当前页面 |
| `/profile/student/[id]` | 见页面权限布局 | 当前页面 |
| `/profile/teacher/[id]` | 见页面权限布局 | 当前页面 |
| `/profile/user/[id]` | 见页面权限布局 | 当前页面 |
| `/super_admin` | 见页面权限布局 | 当前页面 |

## Training Engine V2 路由职责

`/org/:organizationId/training-sessions/:id/design` 与 `/personal/training-sessions/:id/design` 只负责 DRAFT 设计和发布检查；`/training-sessions/:id` 负责 SCHEDULED/RUNNING/PAUSED/ENDED 运行控制。运行工作台展示当前 StageGroup 的要求、独立计时、换组和干预，不把旧的上一阶段回滚作为入口。

