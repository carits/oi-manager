# AI Context Gap List

> 作用：保存“已经由当前代码验证、但尚未完成”的短清单，避免每轮重新全仓证明。  
> 这不是产品 backlog，也不替代 STATUS / CHANGELOG / Issue Tracker。

## 使用规则

- 新增 Gap 前必须从当前代码或当前测试中得到证据。
- 每项必须记录 `last_verified` commit。
- 修复后移动到 Recently closed，并记录 closing commit。
- 如果 Gap 涉及架构/Schema/权限，仍按 AGENTS.md 更新正式领域文档。
- 不在这里记录未经验证的想法。

---

## training-engine

### Open

- **TRN-GAP-001 — 退役 `FROM_BEGINNING`**
  - severity: P0
  - type: domain-correctness
  - last_verified: 506b8bf2
  - evidence: Training join mode、创建 UI 与 `advanceFromBeginningParticipant` 仍保留个人 Stage 推进语义。
  - target: TrainingSession 任意时刻仅存在一个全局 current Stage；迟到学员只进入当前 Stage 或由教师在当前 Stage 内分配。

- **TRN-GAP-002 — 提交后必须保留编辑器代码**
  - severity: P0
  - type: usability-correctness
  - last_verified: 506b8bf2
  - evidence: TrainingSessionWorkspace 提交成功后仍保存空草稿、调用 `clearSubmissionDraft` 并 `setCode('')`。
  - target: 提交成功后保留代码和当前语言，允许 WA / 部分分后继续修改。

- **TRN-GAP-003 — 锁定题目元数据不可默认泄露**
  - severity: P1
  - type: teaching-semantics
  - last_verified: 506b8bf2
  - evidence: 学生工作台会渲染锁定题目的题号和标题，仅禁用打开。
  - target: 权限至少区分 metadata visibility 与 open/submit permission；需要隐藏的训练只显示占位。

- **TRN-GAP-004 — Training Draft 仍按 Problem 而非 StageProblem 定位**
  - severity: P1
  - type: behavior-boundary
  - last_verified: 506b8bf2
  - evidence: `TrainingSessionProblemDraft @@unique([sessionId,userId,problemId])`。
  - target: 明确同题跨 Stage 时“继承代码 / 空白开始”的产品语义，并据此迁移 Draft identity。

- **TRN-GAP-005 — StageProblem 未固定题面版本**
  - severity: P1
  - type: reproducibility
  - last_verified: 506b8bf2
  - evidence: StageProblem 固定 TestSetRevision 与 Judge projection，但未保存 statement revision/snapshot。
  - target: 发布后题面和评测数据来自同一不可变语义版本。

- **TRN-GAP-006 — OI Subtask 依赖闭包未强制**
  - severity: P1
  - type: rule-correctness
  - last_verified: 506b8bf2
  - evidence: Designer 已读取并展示 dependencies；选择 allowedSubtaskIds 时仍可独立勾选依赖子任务。
  - target: 保存/投影时自动闭包或拒绝缺失依赖，并在 UI 明示自动包含内容。

- **TRN-GAP-007 — Hint 缺少完整编辑/删除闭环**
  - severity: P1
  - type: feature-completeness
  - last_verified: 506b8bf2
  - evidence: 现有 Training Hint API 主要覆盖 create/list/open；设计器没有完整编辑/删除操作。
  - target: PENDING Stage 支持编辑/删除；RUNNING Stage 的 Definition 按冻结规则处理。

- **TRN-GAP-008 — 当前 Stage 时间与部分分目标缺少持续可见反馈**
  - severity: P1
  - type: usability
  - last_verified: 506b8bf2
  - evidence: Workspace 拥有 planned/active/effective time、scoreGoals 等数据，但学生/教师主视图未形成持续倒计时和目标进度。
  - target: 学生和教师都能一眼看到当前 Stage、剩余时间、当前组、完成度、当前 score goal。

- **TRN-GAP-009 — 教师运行台需要课堂优先级与大班筛选**
  - severity: P1
  - type: usability
  - last_verified: 506b8bf2
  - evidence: 教练控制区同时展示大量同级操作；学员状态列表缺搜索/卡题/组别/完成度筛选与排序。
  - target: 高频 Stage 控制前置，干预/危险操作分组；大班支持搜索、筛选、排序和按组查看。

- **TRN-GAP-010 — Training Workspace 枚举人类文案仍有旧映射**
  - severity: P2
  - type: ui-correctness
  - last_verified: 506b8bf2
  - evidence: Progress / peer visibility 映射仍包含 `IN_PROGRESS`、`SUMMARY`、`RANKING` 等旧值。
  - target: 统一使用当前 Contract 枚举与共享 human presentation。

### Recently closed

- **StageGroup / ParticipantAssignment / ProblemPlan / RuntimeSnapshot / GroupChange / TimeAdjustment**
  - closed_in: aebe16cb
  - verified_through: 506b8bf2

- **Session-level Group / productMode / BACK_STAGE / legacy StageMode**
  - closed_in: aebe16cb
  - verified_through: 506b8bf2

---

## contest

### Open

当前未在本 Gap List 建立新的已验证项。比赛相关事实以当前代码、架构进度和对应领域文档为准；不要从历史聊天恢复旧 Gap。

---

## organization

### Open

当前未在本 Gap List 建立新的已验证项。组织兼容退役状态优先读取 `docs/architecture-progress.json`。

---

## judge

### Open

当前未在本 Gap List 建立新的已验证项。Judge canonical cutover 状态优先读取 `docs/architecture-progress.json` 与 Judge 领域文档。
