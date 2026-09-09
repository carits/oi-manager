---
status: current
audience: development, testing, operations
last_verified: 2026-09-09
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

V1 支持 `PRIVATE / ORGANIZATION / UNLISTED / PUBLIC`。`UNLISTED` 只允许直接访问，不进入题目、比赛、题解、标签等反向发现结果。V1 所有读接口仍需要登录；暂未开放匿名 SEO 读取。

## 结构化事实引用

Markdown URL 不是事实索引。发布时 `BlogPublishService` 解析草稿中的结构化引用，裁剪为无敏感字段的 `snapshotData`，并生成不可变 `BlogReference`。

| 引用 | 固定规则 |
|---|---|
| PROBLEM | 可跟随题目当前基本信息，仍在发布时检查题目权限 |
| PROBLEM_REVISION | `problemId + ProblemTestSetRevision.id` 必须同题 |
| SOLUTION_VERSION | 必须固定 `ProblemSolutionVersion`，并按该版本固化的 `visibilityPolicy` 授权 |
| CONTEST_STANDING | 只允许本人参加过的 FINALIZED/SUPERSEDED StandingSnapshot |
| RATING_CHANGE | 只允许本人的已应用/已超越 RatingChange |

发布遍历所有引用，博客范围超过任一来源最大安全范围即返回 `BLOG_REFERENCE_VISIBILITY_CONFLICT`。PUBLIC 博客不能携带私有题目或 MANAGER_ONLY/AFTER_AC 题解版本。源版本被超越时只动态显示 SUPERSEDED，不替换原快照。

`SUBMISSION` 与 `JUDGE_RUN` 在 V1 明确返回 `BLOG_SUBMISSION_SNAPSHOT_REQUIRED`，不存在模糊的动态直引用通道。后续只能通过作者显式授权、字段裁剪且永不包含 Hidden Holdout/Wrong Corpus/Kill Vector 的独立安全快照实现。

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

`/personal/blogs` 提供本人列表，`/personal/blogs/new` 和 `/personal/blogs/[id]` 共用 Markdown 编辑/阅读/版本历史工作台，`/personal/blogs/series` 管理系列元数据和文章顺序。题目详情的“相关博客”页签使用 `BlogReference` 反向索引。

V1 不实现评论、点赞、收藏、举报、推荐、付费内容、匿名公开读取、附件上传或可执行代码。比赛、题解和题目的反向入口是最小联动，不将 Blog 变成原领域的事实源。
