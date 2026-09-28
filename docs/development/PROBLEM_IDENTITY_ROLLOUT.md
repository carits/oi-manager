---
status: current
audience: development
last_verified: 2026-09-28
source_of_truth: packages/contracts/src/problem-selection.ts, packages/shared/src/oj-platforms.ts, apps/server/src/modules/problem/problem.identity.ts, apps/server/src/modules/problem-selection/problem-selection.service.ts, apps/web/src/features/problem-selection/, e2e/problem-reference/, e2e/tests/problem-reference-integration.spec.ts
---

# 题目主身份与统一本地题目引用

## 本轮范围与发布边界

开发分支为 `feature/unified-problem-reference`，PR #9，从 `main` 的
`73c5b9df5de8d5f772eefcb02fae1a3f0bd65e63` 建立。分支验证不表示合并或部署。
本轮不修改 Prisma schema、迁移目录、数据库 baseline、生产数据或既有业务引用。
CI 使用的临时 PostgreSQL `test` / `e2e` schema 不属于业务数据库。

目标是统一“引用已经存在的题目”，不把题库浏览、题目自身身份编辑、管理员显式导入
混入选题控件。旧 `QuickProblemInput` 与默认批量 textarea 已退役。

## 唯一身份与只读检索

`POST /api/problem-selection/resolve` 接收 `{ items: [{ clientKey, platform, problemId }] }`。
每批 1–100 项，clientKey 唯一，题号最长 128 字符。selection 接口的历史线路字段
`problemCode` 已改为 `problemId`；Web、Server 和 Contracts 必须作为同一版本发布。
本轮没有增加旧线路双读兼容。

平台通过共享 Registry 的 key、displayName 和显式 aliases 规范化为英文小写 key。
中文显示名称可以在边界被识别，未登记简称不猜测，也不默认到其他平台。
题号只 trim；大小写、前导零和原始前缀保持不变，不把题号整体转成小写。

Resolver 只查 `Problem.platform + Problem.problemId`，共用题目领域
`findPrimaryProblemIdentities` 的授权与冲突规则。不检索附加 OJ 绑定、标题、别名，
不把 Carits 题号当内部 UUID，不调用 OJ Adapter、抓题队列、远程 IO 或任何写入。
平台与题号按成对条件查询，不能组合成两个独立 IN 条件。

返回的 `problem.id` 是内部 Problem ID，`problem.platform + problem.problemId` 是平台身份。
其他业务命令已有的 `problemId` 外键字段仍可能表示内部 ID，不应对全仓库机械重命名。

无权披露的题目与不存在题目返回同一种 not_found；有权查看但未发布/已归档的题目
返回 not_published。当前平台库和组织范围出现多个可访问的相同主身份时返回
identity_conflict，不默认选学校、平台或第一条。其他学校的私有题不参与冲突披露。
数据库异常走请求错误，不伪造查无此题。

当前数据库唯一约束仍是 `libraryKey + platform + problemId`。历史中文/非规范平台
不会在检索中自动补偿；全局唯一与学校副本治理属于单独批准的数据阶段。

## 六处业务接入

| 入口 | 业务文件 | requireStable |
|---|---|---|
| 比赛 | ContestFormModal.tsx | true |
| 作业 | AssignmentWorkspace.tsx | true |
| 训练快速创建 | TrainingSetupDialog.tsx | false |
| 训练阶段设计 | TrainingSessionDesigner.tsx | false |
| 训练运行期追加 | TrainingSessionWorkspace.tsx | false |
| 题单章节添加 | ProblemListDetailPage.tsx | false |

全部入口使用 `features/problem-selection` 的公共组件。业务页面不再自行实现按题号解析。
题单待保存行直接持有已经解析的 canonical Problem，而不是另一套 resolving/resolved/found。

身份命中与业务可用性独立：没有 Stable 时仍显示真实题名链接，但严格入口禁止添加并
解释原因。训练最终运行要求由训练命令再次校验；前端选题成功不是发布许可。

## 默认交互与链接

默认是一行“平台 / 单题号 / 就地检索结果 / 添加”。停止输入 400ms 自动查询；Enter
只立即检索，不隐式添加，也不提交外层表单。中文输入法组合阶段不发查询。
多题号和 URL 不能放入单题框；多题号使用明确的批量入口。

题名来自服务端 canonical Problem，不允许手填。未输入、检索中、未找到、未发布、
身份冲突、重复、业务条件不满足和请求失败保持可区分。网络失败可原地重试。

`ProblemReferenceLink` 按当前 URL 生成工作区内链接；全局账号角色不能把个人工作区
链接改成平台管理链接。`/admin` 映射到实际存在的 `/platform-admin/problems` 详情入口。
链接使用内部 ID，默认在新窗口打开，避免离开正在编辑的表单；训练已选题目链也复用它。

布局使用现有设计令牌并随可用宽度换行。批量对话框通过 Portal 挂在 document.body，
避免训练创建弹窗或阶段抽屉的变换/裁剪约束其遮罩。批量界面不再创建嵌套 form。

## 请求生命周期和添加回执

单题与批量共用 `useProblemReferenceResolver`。手动检索先取消防抖计时器；相同正在
执行的请求不会重复发起。换题号、换平台、换账号/工作区/业务目标、禁用与卸载会取消
旧 transport，并通过 generation、当前上下文和请求键拒绝迟到结果。

响应除了 Runtime Contract，还检查完整行数、唯一 clientKey、题号/平台一致性和
返回 Problem 的身份一致性。缺行、混入别的请求或身份矛盾必须报请求错误，不能添加。

单题与批量共享同步 in-flight 锁，避免连续点击重复回调。添加时重新检查当前已选 ID
和业务条件，不使用检索发起时的旧重复判断。

`onAdd(problems, context)` 中 context 提供 signal 与 isCurrent。异步业务调用必须在
等待后、修改表单前重新检查上下文。可以返回 `{ acceptedIds, rejected }`，未确认的题目
保留为失败行；原同步 void 回调仍表示整批接收。不得把没有接收的题号静默清空。

训练设计器逐题加载详情后返回明确的部分接收回执，目标阶段已经删除、锁定或变化时
不写入旧目标。多阶段添加以目标交集判重：仅在全部目标都包含该题时才算重复。

批量检索与加入分开。成功项保留在业务表单，失败项保留原输入与原因，可单独重试；
超过 100 题明确拒绝而非截断。关闭未处理输入前确认，已经选入的题目不随关闭删除。
“选入当前表单”与“已保存到服务端”是不同状态，最终保存仍由各领域命令负责。

## 验证层级与证据

- `.github/workflows/problem-identity-check.yml`：不可连接的 DATABASE_URL、Prisma 目录零差异、
  Contracts/Shared 构建、客户端类型生成、Server/Web 类型检查、mocked 本地 resolver、
  Web 模型/六处接入断言和 docs/architecture/UI/routes 门禁。不执行业务数据库迁移。
- `.github/workflows/problem-reference-browser.yml`：真实生产组件、API client、契约与样式，
  在 React StrictMode 和 Chromium/Firefox/窄屏 Chromium 中运行。仅 Auth/Next 路由与
  本地 API 响应为测试替身。覆盖防抖、Enter、组合输入、迟到响应、回执、重复、关闭、
  禁用、上下文隔离、链接、存储失败和布局。它不是六个完整业务页面的发布验收。
- `.github/workflows/problem-reference-pages.yml`：在隔离 `e2e` schema 启动真实 API 和 Next，
  用已认证教师检查实际训练创建弹窗的本地解析、链接、明确添加和嵌套批量弹窗，覆盖
  桌面与紧凑桌面。不把它扩大成比赛/作业等全部保存发布闭环。
- `.github/workflows/ui-e2e.yml`：独立的全站回归。聊天集成/并发用干净 `test` schema，
  浏览器 seed 用 `e2e` schema，避免默认表情包污染聊天测试。失败产物不打包 runtime
  password JSON 或浏览器认证 storageState。

已取得的提交级基线：`8f003e2a5b26fd03ab14e0db0bd3c75dec05605e` 的无数据库专项
运行 `36437326963`、文档运行 `36437326727` 和组件浏览器运行 `36437326738` 成功；
浏览器为 21 个场景在三个项目中执行 63 项。后续提交必须读取对应的 Actions 结果，
不能直接沿用该基线数字。真实页面和全站结果分别以各自工作流为准。

## 保存完整性与后置数据阶段

此前显式主身份、Carits 服务端编号、损坏绑定只读保全、expectedUpdatedAt 并发保护、
比赛保存基线与写后恢复仍然保留。详细背景见
[保存正确性与交接](./PROBLEM_SAVE_INTEGRITY_HANDOFF.md)。比赛多请求保存不等于服务端
整批事务或持久化幂等；本轮没有把这些未完成事项标为完成。

迁移前仍须只读盘点旧平台、未知 key、身份冲突、学校副本和跨表引用，取得批准清单并
完成恢复演练。不得为了让选题成功而自动重写历史平台、合并题目、删除学校归属、改换
内部 ID 或对业务数据执行迁移、seed、reset、去重或全量 UPDATE。

历史本地身份阶段的 `c33b43fac5b11165e049157e2cd4aa45469276b0` / Actions
`36377629972` 与保存完整性阶段的验证记录只证明当时提交，不作为本分支上线凭据。
