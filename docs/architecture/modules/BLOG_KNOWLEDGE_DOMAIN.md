---
status: current
audience: development, testing, operations
last_verified: 2026-09-11
source_of_truth: apps/server/src/modules/blog, apps/server/prisma/schema.prisma, apps/web/src/components/blog
---

# Blog / Knowledge Publishing Domain

## 领域边界

Blog 是题目、题解、比赛和 Rating 事实之上的知识叙事层，不是正式题解、评测事实或经济奖励来源。

```text
BlogPost → mutable BlogPostDraft
        → immutable BlogPostVersion
                      ├─ immutable BlogReference
                      └─ immutable classification snapshot

BlogPostVersion ─COPY→ SolutionContribution(DRAFT)
                              → 独立验证与审核
                              → ProblemSolutionVersion
```

博客不得直接成为 `ProblemSolution`。“作为题解投稿”只复制选定的固定 Blog Version，后续的草稿修改不会改动审核中的题解内容。发布博客、浏览或标签不生成 ContributionEvent/Carits。

## 版本与可见性

草稿使用 `revision` CAS 并可覆盖编辑；每次发布创建新 `BlogPostVersion`。数据库触发器禁止修改/删除版本内容与修改/删除引用，仅允许旧版本从 CURRENT 变为 SUPERSEDED。

每个版本单独固定 `visibility` 与 `organizationIdSnapshot`。读取历史版本时使用该版本的发布范围，而不是 `BlogPost` 当前范围；因此 PRIVATE/ORGANIZATION V1 后续发布 PUBLIC V2 不会泄露 V1。版本列表同样先逐版授权，再返回可读子集。

支持 `PRIVATE / ORGANIZATION / UNLISTED / PLATFORM / PUBLIC`。`UNLISTED` 只允许登录用户通过直接地址访问，不进入题目、比赛、题解、标签等反向发现结果；`PLATFORM` 可进入站内发现，但必须登录；`PUBLIC` 可通过 `/blog` 和 `/api/blog-discovery` 匿名发现与阅读。匿名响应以空本人反应和未收藏状态返回；同一公共端点在登录态必须加载当前账号真实的反应与收藏，避免公共阅读页把已有互动显示成未操作。

## 结构化事实引用

Markdown URL 不是事实索引。发布时 `BlogPublishService` 解析草稿中的结构化引用，裁剪为无敏感字段的 `snapshotData`，并生成不可变 `BlogReference`。

| 引用 | 固定规则 |
|---|---|
| PROBLEM | 可跟随题目当前基本信息，仍在发布时检查题目权限 |
| PROBLEM_REVISION | `problemId + ProblemTestSetRevision.id` 必须同题 |
| SOLUTION_VERSION | 必须固定 `ProblemSolutionVersion`，并按该版本固化的 `visibilityPolicy` 授权 |
| CONTEST_STANDING | 只允许本人参加过的 FINALIZED/SUPERSEDED StandingSnapshot |
| RATING_CHANGE | 只允许本人的已应用/已超越 RatingChange |
| SUBMISSION_SNAPSHOT | 只允许作者显式创建的脱敏、不可变 Submission 快照 |

发布遍历所有引用，博客范围超过任一来源最大安全范围即返回 `BLOG_REFERENCE_VISIBILITY_CONFLICT`。PUBLIC 博客不能携带私有题目或 MANAGER_ONLY/AFTER_AC 题解版本。源版本被超越时只动态显示 SUPERSEDED，不替换原快照。

`SUBMISSION` 与 `JUDGE_RUN` 直接引用始终返回 `BLOG_SUBMISSION_SNAPSHOT_REQUIRED`，不存在模糊的动态直引用通道。提交作者只能为已经终态的本人提交创建 `BlogSubmissionSnapshot`；非公开题目范围只能创建 PRIVATE 快照。快照只固化 Verdict、分数、耗时、内存、语言、提交级 IO、来源摘要和可选源码，不保存测试点、Subtask 明细、Judge 错误、文件路径、Hidden Holdout、Wrong Corpus 或 Kill Vector。数据库禁止更新和删除快照，发布时再按快照范围校验博客可见性。

## Markdown 安全渲染

客户端使用 `securityProfile="knowledge"`，服务端在草稿和发布时重复执行安全契约：

- 支持 Markdown、LaTeX、表格与围栏代码，不执行代码；
- 不渲染 raw HTML，拒绝危险标签与 `javascript:/data:/vbscript:` 协议；
- 外链统一 `nofollow noopener noreferrer`；
- 禁止外部 Markdown 图片，仅允许通过认证的平台资产或后续安全代理；
- Markdown UTF-8 上限 1 MiB，不允许 NUL。

## Series 与 Tags

`BlogSeries` 可属于个人或组织，名称经 NFKC、空白合并和小写化生成范围唯一键。系列元数据与文章顺序都使用 `revision` CAS；重排必须提交完整且无重复的 post ID 集合。发布时要求文章与系列的归属、可见范围一致，防止系列目录泄露文章身份。

`BlogTag` 分为平台管理员创建的 SYSTEM 与作者命名空间的 USER。两类都以 NFKC 规范化键唯一，单篇最多 5 个；输入同名系统标签时优先复用系统标签。`BlogPostTag` 服务当前反向查询，当时的系列/标签同时固化到 BlogPostVersion，避免旧版本分类被静默改写。

## Web 与当前范围

`/blog` 和 `/blog/[id]` 是脱离工作区外壳的公共发现与分享入口：匿名用户只看到 PUBLIC，登录用户同时看到 PLATFORM。站内阅读使用 `/personal/knowledge[/id]`、`/org/:organizationId/knowledge[/id]`、`/admin/knowledge[/id]` 或 `/platform-admin/knowledge[/id]`，复用同一发现/详情组件但保留原工作区的 AppShell、身份、消息、通知与返回路径。`/personal/blogs` 提供本人列表，`/personal/blogs/new` 和 `/personal/blogs/[id]` 共用 Markdown 编辑/阅读/版本历史工作台，`/personal/blogs/series` 管理系列元数据和文章顺序。全局管理员不显示“我的文章”，只进入各自管理工作台。题目详情的“相关博客”页签使用 `BlogReference` 反向索引。

全站只有根布局创建 `AuthProvider`，根布局用服务器 Session 初始化身份；受保护的 `RoleLayout` 只负责鉴权和工作区外壳，禁止再创建第二份客户端身份状态。导航上下文由账号角色和 URL 共同解析：全局管理员优先固定为平台上下文，普通账号再按 `/org` 或个人路径区分。`/account/*` 不得把全局管理员误判为个人工作区；Logo、知识入口和固定引用必须使用同一个导航上下文。组织上下文失效时统一返回 `/identity?organizationUnavailable=1` 重新选择有效身份。

公共阅读顺序为标题作者、标签系列、正文、固定引用、系列导航、互动和评论。系列上一篇/下一篇由服务端逐篇执行当前访问者权限后生成，不能泄露不可见条目；匿名写操作统一跳转登录并携带经过站内路径校验的原文 `next`，已登录用户访问登录入口时直接回到该安全路径。分类和引用使用公共共享展示组件，作者工作台与公共页面不再维护两套解释。题目与 Revision 链接由当前导航上下文决定个人、组织或平台管理路径；匿名公共阅读在没有公开 canonical 资源页时不生成伪造的私有内部链接。题解、榜单与 Rating 同样遵循该规则；脱敏 Submission Snapshot 只允许在当前卡片展开其固定安全字段，不生成可枚举私人提交记录的链接。

社区读取使用 `loading / ready / error` 三态。传输错误、5xx 或不完整响应必须展示请求错误与局部重试，不能渲染成 0 次互动或空评论。公共文章页由服务器生成标题、摘要与 canonical metadata；互动区仍为客户端组件。

Blog 编辑器将类型、slug、组织、可见范围和完整草稿统一序列化后与保存基线比较。全局未保存保护同时覆盖 SPA 链接/工作区切换与浏览器刷新关闭；保存成功后才更新基线，冲突或失败继续保留本地内容。

已发布且当前用户有权读取的博客支持一层回复的评论、`LIKE/HELPFUL` 反应、账号收藏和文章/评论举报。评论首页每条只携带首批回复和 `replyCount`，更多回复使用游标接口分页加载。匿名用户可读取 PUBLIC 评论，但所有写操作仍需登录。删除评论保留记录并隐藏正文展示；反应和收藏使用用户与目标的数据库唯一键保证幂等。举报创建时固化当前文章版本哈希或评论正文证据，重复待处理举报返回冲突。

平台管理员和超级管理员通过 `/platform-admin/blog-moderation` 或 `/admin/blog-moderation` 处理举报与社区精选。举报列表不返回证据正文；管理员必须填写查看原因，服务端写 `PlatformAuditLog` 后才返回固化证据。隐藏评论、暂停/移除文章、处理结论和精选变更均由服务端重新鉴权并写审计。精选是可退役的治理事实，不覆盖 Blog Version。

当前仍不实现付费内容、附件上传、深层回复或可执行代码。比赛、题解和题目的反向入口是最小联动，不将 Blog 变成原领域的事实源。
