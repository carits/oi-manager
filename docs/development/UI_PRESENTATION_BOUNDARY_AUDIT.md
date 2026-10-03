---
status: current
audience: development
last_verified: 2026-10-03
source_of_truth: apps/web/src and scripts/ui-language-check.mjs
---

# 前端呈现边界审计与整改清单

## 整改状态（2026-10-03）

- 基础入口已收口：`ApiError` 分离用户信息与诊断信息，未知错误 fail-closed；运行时错误、契约名称和服务端原始 message 不再直接进入业务 UI。
- 展示适配已收口：评测结果、语言、OJ 平台、钱包、贡献、成员关系、训练、比赛、题解审核等未知枚举均使用严格 mapper，不再回退原始值。
- 普通与管理页面已清理：revision、snapshot、Stable/Evolving、slot、graph hash、fencing token、内部 ID、raw JSON 等实现信息不再作为普通页面文案；request ID 仅在默认收起的诊断信息中提供。
- 用户导出已清理：训练 CSV 使用平台、题号、题目等业务字段，不再导出阶段题目关系 ID。
- 长期门禁已落地：仓库级 `AGENTS.md`、PR 用户语言审计模板、`scripts/ui-language-check.mjs` 与现有 `ui:state-check`/CI 已形成闭环；服务端内置 UI 模板也纳入扫描。
- 验证证据：Web 单元测试 59 文件/401 项通过，Evaluation Budget 10 项服务端测试通过，Web 类型检查、完整生产构建、文档源检查、`ui:state-check` 与 `git diff --check` 通过。
- 已知独立基线：文档总门禁仍会报告 main 既有的 9 个 Rating 路由缺显式 auth policy；全量浏览器 smoke 暴露排名列宽、导航折叠和旧 ProblemReference 交互等主干旧断言，并按用户要求停止，未以本次改动掩盖或放宽这些失败。


下面是目前**已经确认存在**的问题清单。我把同一根因的多个页面合并成一个问题项，但会把已发现的具体文件和例子列出来。这样后面可以按任务逐项修，而不是继续零散改文案。

1. **未知枚举值会直接原样显示给用户 — P0**

   已确认位置包括：

   - `TrainingStageTimeline.tsx`
     ```ts
     stageKinds.find(...)?.[1] || stage.kind
     ```
   - `TrainingSessionWorkspace.tsx`
     ```ts
     interventionLabel[item.type] || item.type
     visibilityLabel[...] || peerProgress.peerVisibility
     rankingLabel[...] || peerProgress.rankingMode
     ```
   - `AssignmentWorkspace.tsx`
     ```ts
     learningLabel[...] || progress.learningStatus
     correctionLabel[...] || item.status
     ```
   - `ContestProblemList.tsx`
     ```ts
     RESULT_LABEL_MAP[status] || status
     ```
   - `ContestRankingSubmissionsModal.tsx`
   - `ContestSubmissionPanel.tsx`
   - `SubmissionList.tsx`
   - `SubmissionDetailContent.tsx`
   - `SubmissionJudgeResult.tsx`
   - `SolutionEditorialPanel.tsx`
   - `TrainingRatingPanel.tsx`
   - `OrganizationJoinManagement.tsx`
   - `app/admin/users/*`
   - `app/platform-admin/users/*`
   - `BlogWorkspace.tsx`
   - `ChatWorkspace.tsx`
   - `wallet-display.ts`
   - `contribution-display.ts`

   **怎么解决：**

   所有业务 enum 必须通过一个完整 presentation function：

   ```ts
   trainingStageKindLabel(value)
   contributionStatusLabel(value)
   judgeResultLabel(value)
   membershipStatusLabel(value)
   ```

   未知值统一：

   ```ts
   return '状态待确认'
   ```

   或者根本不显示。

   **绝对禁止：**

   ```ts
   labels[value] || value
   labels[value] ?? value
   map.find(...)?.label || value
   `未识别状态：${value}`
   ```

   验收标准：给每个 mapper 输入 `FUTURE_INTERNAL_VALUE`，页面中不得出现这个字符串。

2. **`revision` 直接进入 UI — P0**

   已确认：

   - `ContestContentSelectionModal.tsx`
     > 当前 revision 17
   - `ProblemHackConfigPanel.tsx`
     > 当前配置 revision 4
   - `ProblemJudgeAssetsPanel.tsx`
     > Corpus R17
   - `BlogListPage.tsx`
     > 草稿 R3
   - `BlogSeriesManager.tsx`
     > revision 乐观锁
   - `ProblemQualityPanel.tsx`
     > `v${profile.revision}`
   - `humanPresentation.ts`
     > 测试数据版本 R17

   **怎么解决：**

   `revision` 属于并发控制/存储实现，普通 UI 一律删除。

   例如：

   ```text
   当前 revision 17
   → 当前内容
   ```

   ```text
   草稿 R3
   → 草稿
   ```

   ```text
   Corpus R17 已重建
   → 评估数据已更新
   ```

   如果管理员排障真的需要 revision，只允许放到显式的“诊断信息”区域，而且默认收起。

3. **“服务器版本 / 服务端版本”泄漏并发实现 — P0**

   `TrainingSessionDesigner.tsx` 已确认：

   > 已载入最新服务器版本  
   > 用服务器版本替换当前编排？  
   > 保存副本并载入服务器版本

   **怎么解决：**

   用户关心的是“其他地方有更新”，不是 client/server version。

   应改为：

   ```text
   已加载最新内容
   ```

   ```text
   当前内容在其他位置已有更新。
   继续后会保留你尚未保存的修改，并加载最新内容。
   ```

   按“发生了什么 → 会不会丢数据 → 用户做什么”的方式描述。

4. **`snapshot / 快照` 被当成产品语言 — P0**

   已确认：

   - `TrainingSessionWorkspace.tsx`
     > 原始阶段快照保持不变
     > 不可变设计快照
   - `ContestFormModal.tsx`
     > 活动快照历史
   - `StatementVersionWorkspace.tsx`
     > 活动快照不会受影响
   - `BlogModerationWorkbench.tsx`
     > 直接 `JSON.stringify(evidenceSnapshot)`
   - `problem-quality-display.ts`
     > 历史快照
   - Data Market 有 `SNAPSHOT` 产品文案。

   **怎么解决：**

   区分两个概念：

   - 产品真的需要“保存当时内容”：
     > 之前使用的内容仍会保留
   - 纯数据库 snapshot：
     > 完全不出现

   比如：

   ```text
   原始阶段快照保持不变
   → 原有训练安排不会被修改
   ```

   ```text
   活动快照历史
   → 之前使用的内容仍会保留
   ```

5. **Stable / Evolving 直接暴露给教师、学生、题目作者 — P0**

   这是目前范围最大的泄漏之一。

   已确认：

   - `TrainingSessionDesigner.tsx`
   - `TrainingProblemChain.tsx`
   - `TrainingSessionWorkspace.tsx`
   - `AssignmentWorkspace.tsx`
   - `ProblemPrimaryIdentity.tsx`
   - `ProblemTestGraphPanel.tsx`
   - `ProblemJudgeAssetsPanel.tsx`
   - `ProblemQualityPanel.tsx`
   - `ProblemHackPanel.tsx`
   - `ContestHackSyncAction.tsx`
   - `DataMarketplace.tsx`
   - `DataMarketResourcePickers.tsx`
   - `problemSelection.ts`
   - `problem-contribution-display.ts`

   **怎么解决：**

   业务 UI 改成业务事实：

   ```text
   Stable
   → 正式评测数据 / 可用于正式评测
   ```

   ```text
   Evolving
   → 待完善数据 / 当前训练数据
   ```

   但最好进一步避免直接把“两套数据”产品化。

   比如训练只说：

   > 提交时使用当前可用的训练数据进行评测。

   比赛只说：

   > 当前题目已有可用于比赛的评测数据。

   普通用户根本不需要知道数据后面有两个 slot。

6. **`slot / 数据槽 / 测试数据槽位` 被暴露 — P0**

   已确认：

   - `humanPresentation.ts`
     ```ts
     testSetSlot: '测试数据槽位'
     ```
   - `JudgeSettingsTab.tsx`
   - `ProblemTestGraphPanel.tsx`
   - `ProblemJudgeAssetsPanel.tsx`
   - `ProblemQualityPanel.tsx`
   - `DataMarketplace.tsx`
   - `DataMarketResourcePickers.tsx`

   **怎么解决：**

   删除“槽”这个概念。

   根据场景使用：

   ```text
   评测数据
   正式评测数据
   当前数据
   可用数据
   ```

   `humanTerms.testSetSlot` 应直接删除，防止以后继续复用。

7. **Graph Hash 直接显示 — P0**

   已确认：

   - `ProblemTestGraphPanel.tsx`
     > Graph abcdef123456
   - `ProblemQualityPanel.tsx`
   - `ProblemJudgeAssetsPanel.tsx`
   - `ProblemHackPanel.tsx`
   - `PlatformContributionPage.tsx`
   - `DataMarketplace.tsx`
   - `DataMarketResourcePickers.tsx`

   **怎么解决：**

   `graphHash` 完全属于数据一致性标识。

   普通和管理业务 UI 都不默认显示。

   如果平台管理员排障需要：

   ```text
   高级诊断
     数据指纹：abcdef...
   ```

   但必须主动展开。

8. **`fencingToken / 栅栏` 进入用户语言 — P0**

   已确认：

   - `ProblemTestGraphPanel.tsx`
     > 栅栏 #12
   - `ProblemJudgeAssetsPanel.tsx`
     > 栅栏校验
     > Evolving 栅栏快照

   **怎么解决：**

   全部删除。

   例如：

   ```text
   已通过结构、保护和栅栏校验
   → 数据检查已通过
   ```

   ```text
   缺少 Evolving 栅栏快照
   → 当前数据已发生变化，请重新创建任务
   ```

   用户只需要知道“数据变了”，不用知道 fencing token。

9. **Canonical 概念进入 presentation 层 — P0/P1**

   内部使用 `canonicalProblemId` 没问题。

   但 presentation 代码和命名现在仍大量围绕：

   ```text
   canonical
   canonicalStatus
   canonicalProblemId
   canonical duplicate
   ```

   `problem-contribution-display.ts` 等已经把这种内部状态带进用户语言链路。

   **怎么解决：**

   canonical 只能存在于 domain/data 层。

   UI 层只接受：

   ```ts
   ProblemDisplayIdentity
   ```

   例如：

   ```ts
   {
     platformLabel,
     problemNumber,
     title
   }
   ```

   不应该拿 canonical ID 当显示 fallback。

10. **内部 ID 直接给用户看 — P0**

   已确认：

   - Training CSV：
     > 训练题目 ID
     > `stageProblemId`
   - Training report：
     `problemId || stageProblemId`
   - `reportParticipantName(...) || participantId`
   - `reportUserName(...) || userId`
   - `PlatformContributionPage`
     > Candidate ID
     > organization ID
   - `PlatformAiGovernancePage`
     > 用户 ID
   - 部分生成任务显示 `job.id.slice(0,8)`

   **怎么解决：**

   内部 UUID/关系 ID 绝不能当业务 fallback。

   fallback 应是：

   ```text
   题目
   未知学员
   未知记录
   ```

   或整项省略。

   Training CSV 应导出：

   ```text
   题号
   题目名称
   ```

   而不是 `stageProblemId`。

11. **Training CSV 导出包含实现字段 — P0**

   当前：

   ```text
   学员
   分组
   训练题目 ID
   状态
   ...
   ```

   并把 `stageProblemId` 导出。

   **怎么解决：**

   改成：

   ```text
   学员
   分组
   平台
   题号
   题目
   状态
   最高分
   提交次数
   有效训练时长
   ```

   导出文件也属于用户界面边界，必须走同一 presentation contract。

12. **题目贡献系统仍然是一套“研发流水线控制台” — P0**

   `ProblemJudgeAssetsPanel.tsx` 和 `ProblemHackPanel.tsx` 是最严重区域之一。

   已确认直接出现：

   ```text
   Candidate Pool
   Candidate Selector
   Wrong Corpus
   Hidden Holdout
   Evaluation
   Promotion
   HOT
   Selector
   Official Core
   Evolving
   Stable
   Graph
   fencing
   Corpus Rxx
   job id
   ```

   **怎么解决：**

   应整体重做语言模型，不建议逐词替换。

   产品层可以收敛成：

   ```text
   候选测试数据
   自动质量检查
   数据覆盖情况
   待采用测试点
   已采用测试点
   历史测试数据
   ```

   例如：

   ```text
   已进入 Candidate Pool
   → 已进入候选数据池
   ```

   甚至更直接：

   > 已通过初步检查，等待进一步评估。

   用户不需要理解整个 selector/corpus/promotion pipeline。

13. **DQS / Critical Gate / STD / Validator / Holdout 等开发术语进入质量页面 — P0**

   `problem-quality-display.ts` 本身就在生成：

   > 正确性硬门槛已通过，可解读 DQS  
   > 命中正确性 Critical Gate  
   > 缺少 STD、Validator、Checker、完整 Revision 或可用 Evaluation/Holdout

   所以不是页面漏翻译，是 presentation helper 本身就错了。

   **怎么解决：**

   改成真正业务语言：

   ```text
   数据质量检查已通过。
   ```

   ```text
   发现影响评测正确性的严重问题。
   ```

   ```text
   当前缺少完成质量检查所需的评测配置或验证数据。
   ```

   对平台工程师需要的信息放进独立诊断对象，不塞进 `description`。

14. **直接展示内部 JSON — P0**

   已确认：

   - `ProblemQualityPanel.tsx`
     ```tsx
     JSON.stringify(snapshot.evidence.pinnedInputs)
     ```
   - `BlogModerationWorkbench.tsx`
     ```tsx
     JSON.stringify(detail.evidenceSnapshot)
     ```

   **怎么解决：**

   必须创建结构化 presentation component。

   例如：

   ```text
   评估依据
   - 测试数据：已固定
   - 标准程序：已确认
   - 输入校验：已确认
   ```

   绝不能把 API JSON 当 UI。

   真需要原始 JSON 时放到：

   > 高级诊断 → 查看原始数据

   仅平台管理员可见。

15. **后端/API error message 传播面太大 — P0**

   全站大量：

   ```ts
   toast.error(result.error.message)
   setError(error.message)
   <LoadError message={resource.error.message} />
   ```

   涉及：

   - training
   - contest
   - assignment
   - problem
   - team
   - blog
   - chat
   - notification
   - ranking
   - workspace
   - organization
   - auth
   - submission
   - admin

   虽然 `apiClient` 已经部分 humanize，但现在仍是 **fail-open**。

   **怎么解决：**

   `ApiError` 应拆成：

   ```ts
   {
     userMessage: string
     code?: string
     requestId?: string
     debugMessage?: string
     details?: unknown
   }
   ```

   UI 只能访问：

   ```ts
   error.userMessage
   ```

   `debugMessage` 不允许从业务组件读取。

16. **`humanErrorMessage()` 的 fail-open 策略不安全 — P0**

   当前：

   ```ts
   if (fallback && !LOOKS_TECHNICAL.test(fallback)) return fallback
   ```

   所以例如：

   ```text
   expectedRevision mismatch
   invalid stage transition
   snapshot frozen
   canonical problem unavailable
   ```

   都可能漏出来。

   **怎么解决：**

   改成 fail-closed：

   ```ts
   if (knownCode) return mappedMessage
   if (knownSafeStatus) return statusMessage
   return genericMessage
   ```

   原始 message 只写 telemetry/log。

17. **契约名称可能直接显示 — P0**

   `apiClient.ts` 当前能生成：

   ```text
   服务器响应不符合 ${contract.key} 契约
   请求不符合 ${contract.key} 契约
   ```

   页面大量直接显示 `ApiError.message`。

   **怎么解决：**

   UI：

   > 服务返回的数据暂时无法处理，请重试。

   日志：

   ```text
   contract.key
   zod issues
   requestId
   endpoint
   ```

   二者必须分开。

18. **React `ErrorBoundary` 直接输出运行时 `error.message` — P0**

   当前：

   ```tsx
   {this.state.error?.message || '发生了未知错误'}
   ```

   这是一个很危险的总入口。

   **怎么解决：**

   用户固定显示：

   > 页面遇到问题，请重新加载。

   真正 `error.message / stack` 只：

   ```ts
   console.error(...)
   telemetry.capture(...)
   ```

19. **requestId 默认显示给普通用户 — P1**

   已确认：

   - `LoadError`
   - `AsyncRegion`
   - `SessionUnavailable`
   - `ContextualRecovery`
   - `SubmissionDetailContent`
   - `global-error.tsx`
   - 学生管理等所有继承 `LoadError` 的页面

   **怎么解决：**

   requestId 可以保留，但不能默认展示。

   更合理：

   ```text
   遇到问题？
   [复制诊断信息]
   ```

   点开后才包含 requestId。

   或仅管理员展开可见。

20. **博客系统也有 implementation leakage — P0/P1**

   新发现包括：

   - `BlogListPage`
     > 草稿 R3
   - `BlogSeriesManager`
     > revision 乐观锁避免覆盖
   - `BlogWorkspace`
     > 直接显示历史版本 raw `status`
   - `BlogModerationWorkbench`
     > evidenceSnapshot JSON
   - `blog-contract.ts`
     > 提交快照

   **怎么解决：**

   草稿：

   ```text
   草稿 R3
   → 草稿
   ```

   乐观锁：

   ```text
   重排使用 revision 乐观锁避免覆盖
   → 多人同时编辑时会自动避免覆盖其他人的修改
   ```

   raw status 必须 mapping。

   “提交快照”如果是作者明确创建的产品概念，可以叫：

   > 引用的提交记录

   而不是 snapshot。

21. **题解审核存在 raw status / verification status — P0**

   `SolutionEditorialPanel.tsx` 多处：

   ```ts
   SOLUTION_STATUS_LABELS[item.status] || item.status
   VERIFICATION_STATUS_LABELS[...] || raw
   SIMILARITY_JOB_LABELS[...] || raw
   ```

   审核 timeline 甚至直接：

   ```text
   review.reviewType
   review.decision
   ```

   **怎么解决：**

   审核相关全部建立严格 mapper：

   ```ts
   solutionStatusPresentation()
   solutionVerificationPresentation()
   solutionReviewTypeLabel()
   solutionReviewDecisionLabel()
   similarityJobStatusLabel()
   ```

   无 raw fallback。

22. **聊天联系申请直接显示 `request.status` — P0**

   `ChatWorkspace.tsx`：

   ```tsx
   ... · {request.status}
   ```

   **怎么解决：**

   映射：

   ```text
   pending → 待处理
   accepted → 已接受
   rejected → 已拒绝
   cancelled → 已撤销
   ```

   未知值不显示原值。

23. **钱包/贡献 presentation helper 自己也 raw fallback — P0**

   `wallet-display.ts`：

   ```ts
   TRANSACTION_TYPE_LABELS[value] || value
   TRANSACTION_SOURCE_LABELS[value] || value
   `未识别状态：${value}`
   ```

   `contribution-display.ts`：

   ```ts
   CONTRIBUTION_TYPE_LABELS[value] || value
   CONTRIBUTION_SOURCE_LABELS[value] || value
   CANDIDATE_SOURCE_LABELS[value] || value
   ```

   **怎么解决：**

   presentation helper 应当是最严格的一层，而不是 raw fallback 最集中的一层。

   未知值全部变成：

   ```text
   其他
   状态待确认
   来源待确认
   ```

24. **平台/OJ 原始 key 会显示 — P1**

   已确认：

   - `OjAccountManagementPage`
   - `ProblemList`
   - `ProblemDetail`
   - `ContestDetailPage`
   - `ContestProblemList`
   - `SubmissionList`
   - `SubmissionDetailContent`

   现在大量：

   ```ts
   OJ_PLATFORM_LABEL_MAP[value] || value
   ```

   **怎么解决：**

   单一函数：

   ```ts
   ojPlatformDisplayName(value)
   ```

   未知平台：

   ```text
   其他平台
   ```

   只有题目作者的“原始平台 key”诊断区域才能看 raw value。

25. **评测结果和语言的共享 helper 同样 fail-open — P1**

   `judge-constants.ts`：

   ```ts
   getLanguageLabel(...)
   ...
   || lang
   ```

   `JUDGE_RESULT_LABEL_MAP[result] || result`

   **怎么解决：**

   `getLanguageLabel`：

   ```ts
   return known || '其他语言'
   ```

   `judgeResultLabel`：

   ```ts
   return known || '未知结果'
   ```

   不允许 raw protocol value 显示。

26. **Subtask 内部 type 直接展示 — P1**

   `SubmissionJudgeResult.tsx`：

   ```tsx
   {row.subtask.type}
   ```

   **怎么解决：**

   如果 subtask type 真的是业务概念，建立中文映射。

   如果只是数据结构实现字段，直接去掉。

27. **学校/平台后台也存在 raw role / raw status — P1**

   已确认：

   - `OrganizationJoinManagement`
   - `app/admin/users/page.tsx`
   - `app/admin/users/[id]`
   - `app/platform-admin/users/page.tsx`
   - `app/admin/schools/page.tsx`

   比如：

   ```ts
   labels[role] || role
   ```

   和：

   ```tsx
   {selected.Applicant.status}
   ```

   **怎么解决：**

   管理后台也必须遵守 presentation boundary。

   “管理员界面”不等于“数据库调试界面”。

28. **贡献平台审核页直接暴露内部证据模型 — P0**

   `PlatformContributionPage.tsx`：

   > Candidate 详情  
   > Evolving 图哈希详情  
   > Candidate / Evolving 数据槽详情接口  
   > 不会重复创建贡献或 Revision  
   > Candidate ID  
   > organization ID

   **怎么解决：**

   审核员真正需要：

   ```text
   候选测试数据
   数据变化
   贡献来源
   质量检查结果
   奖励状态
   ```

   内部 hash/ID/revision 只进“诊断信息”。

29. **平台 AI 管理页仍是底层资源视角 — P1**

   已确认：

   ```text
   Candidate 评估资源
   Candidate HOT 数据
   Blob / 孤儿
   用户 ID
   item.type raw
   ```

   **怎么解决：**

   这页允许比普通教师技术一些，但仍应该是产品级管理语言：

   ```text
   候选数据占用
   未关联文件
   用户
   资源变动类型
   ```

   Blob、HOT、raw type 放诊断模式。

30. **Problem selection 底层自己生成 Stable/Evolving 用户文案 — P0**

   `problemSelection.ts`：

   ```text
   当前入口需要 Stable 评测数据
   没有可用于训练的 Evolving 或 Stable 评测数据
   ```

   **怎么解决：**

   改成：

   ```text
   已找到题目，但当前没有可用于正式评测的数据。
   ```

   ```text
   已找到题目，但目前没有可用于训练的评测数据。
   ```

   内部 requirement 可以继续叫 `stable/training`，但 presentation message 不得带出来。

31. **`humanPresentation.ts` 本身需要重构 — P0**

   当前最大误区是：

   > 有 `humanPresentation` ≠ 已有用户语言边界。

   现在里面仍有：

   ```text
   测试数据槽位
   测试数据版本 R17
   技术详情：...
   ```

   **怎么解决：**

   把它改成真正的 presentation gateway。

   对外只导出类似：

   ```ts
   displayTrainingStageKind()
   displayTrainingStatus()
   displayJudgeResult()
   displayPlatform()
   displayApiError()
   displayDataReadiness()
   ```

   并明确原则：

   > mapper 永远不能返回输入原值。

32. **现有测试正在保护错误文案 — P0**

   `humanErrors.test.ts`、`humanPresentation.test.ts`、`problem-quality-display.test.ts` 中部分测试把：

   ```text
   测试数据版本
   DQS
   Critical Gate
   Revision
   ```

   当成预期行为。

   **怎么解决：**

   测试也必须同步换成用户语言 contract。

   另外增加：

   ```ts
   expect(rendered).not.toContain('FUTURE_INTERNAL_VALUE')
   expect(rendered).not.toContain('revision')
   expect(rendered).not.toContain('Evolving')
   ```

33. **当前 CI 没有“用户语言门禁” — P0**

   现有：

   - `ui-contract-check.mjs`
   - `ui-state-check.mjs`

   都无法阻止这些问题。

   而且 `ui-state-check` 还没有覆盖整个 `features/`。

   **怎么解决：**

   新增：

   ```text
   scripts/ui-language-check.mjs
   ```

   扫描整个：

   ```text
   apps/web/src/**
   ```

   至少阻止：

   ```text
   labels[x] || x
   labels[x] ?? x
   revision 用户文案
   snapshot 用户文案
   Stable/Evolving
   graphHash
   fencingToken
   canonicalProblemId
   stageProblemId
   raw status/type/kind
   JSON.stringify(...) 直接进入 JSX
   ```

   并加入 CI。

34. **需要建立“诊断信息”与“用户信息”两套通道 — 架构修复**

   这其实是上面所有问题的最终解决办法。

   当前是：

   ```text
   Domain/API
       ↓
   React Component
       ↓
   用户
   ```

   应该改成：

   ```text
   Domain/API
       ↓
   Presentation Adapter
       ├── User Presentation
       │      ↓
       │     UI
       │
       └── Diagnostic Presentation
              ↓
          admin expandable panel / telemetry / log
   ```

   普通 UI 永远只拿业务事实。

   `revision / hash / internal ID / fencing / raw enum / raw error` 只能进入诊断通道。

---

### 最适合的实际修复顺序

这批问题不能按页面一个个改。正确顺序应该是：

**第一批先堵入口**：`humanErrors`、`humanPresentation`、enum mapper、`ErrorBoundary`、`LoadError/requestId`、`judge-constants`、OJ platform mapper。

**第二批清普通用户面**：Training、Assignment、Contest、Submission、Blog、Chat、Workspace。

**第三批清教师/题目作者面**：Problem selection、题目编辑、Hack、质量评估。

**第四批重做技术型后台语言**：ProblemJudgeAssets、Data Market、Contribution admin、AI Governance。

**最后加 CI gate 和回归测试**，否则以后还会重新长出来。

从目前已经确认的代码看，这个任务已经不是“文案优化”，应该按一次**前端 presentation boundary 重构**来做。最核心的验收标准可以浓缩成一句：

> **任何数据库/API/并发控制/数据一致性概念，都必须经过显式 presentation adapter 才允许进入 UI；未知值默认隐藏或显示通用业务语言，绝不 raw fallback。**