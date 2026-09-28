---
status: current
audience: development
last_verified: 2026-09-28
source_of_truth: packages/shared/src/oj-platforms.ts, apps/server/src/modules/problem/problem.identity.ts, apps/server/src/modules/problem-selection/problem-selection.service.ts, apps/web/src/features/problem/ui/ProblemForm.tsx, apps/web/src/features/contest/ui/ContestFormModal.tsx
---

# 题目主身份与纯本地检索：无数据库变更阶段

## 当前实施：2026-09-28 保存正确性修复

当前工作分支为 `fix/problem-save-integrity-20260928`，起点是
`codex/problem-management-completion` 的 `c1dcd5a6c14020c75cfa6391efabf361ff2fffcb`。
本记录描述分支代码，不代表合并、部署、完成数据库清理或整套 A01—A16 改造。

当前逐项状态、提交、验证范围与 Codex 接手顺序见
[保存正确性与 Codex 后置交接](./PROBLEM_SAVE_INTEGRITY_HANDOFF.md)。
该交接是仓库文档，不是已经启动的 Codex 后台任务。

继承的显式主身份与绑定解耦代码已经存在；本轮进一步完成以下代码修改：

- 公共选择器复用题目领域 `findPrimaryProblemIdentities`，与已有普通提交 helper 使用同一授权与身份冲突规则；仅对唯一可披露记录只读补充 Stable 信息。
- 题单过渡接口校验内部引用与冗余平台/题号的一致性，条目平台从真实授权题目生成；不改写历史 Problem 行。
- 历史附加来源无法安全读取时保持只读，保存请求省略该字段，不以 `[]` 覆盖；正常显式清空仍发送空数组。
- 题目编辑器按账号、工作区与题目重建上下文，恢复 Effect setup 的有效上下文；加载失败不开放空白编辑器，保存提示使用实际未保存差异。
- 比赛保存逐步检查响应，删除依据加载基线中的明确移除项；新增 ID 绑定原 client row，保持新旧题交错顺序，排序后回读确认。
- 比赛写后失败保留本地草稿和已确认步骤，不关闭、不报整体成功；暂时停止直接重试，提供草稿导出和新窗口核对入口。

比赛仍是多请求保存。前端预检不能消除检查与写入之间的竞态，不代表目标内事务、原子并发版本或服务端幂等已完成。
统一逐行选择器的六处迁移、全系统平台写入边界、离线审计工具与数据库阶段仍见交接中的后置清单。

### 当前分支验证状态

本轮仅对两个新增模型的同字节副本做语法转译与 18 项隔离断言；绑定读取断言使用替代 Registry。
这不代表 Server/Web 全项目类型检查、构建、Vitest 或浏览器验收通过，详情和 blob SHA 已记录在交接文档。
本轮未取得完整 checkout，未运行项目级文档、架构或路由门禁；读取分支 Actions 时没有运行记录。
没有连接业务数据库、执行迁移或部署。下方历史分支的测试数字不能作为本分支的验证结果。

## 历史基础：本地身份检索阶段

原始分支为 `codex/problem-identity-local-lookup`，起点 `f04b0aa5`。
以下保留该阶段的设计和历史验证记录；本轮没有重新运行其全量验收。

平台名称通过共享 Registry 的 key、displayName 和显式 aliases 精确映射成英文小写 key。
中文显示名也能在数据边界被识别；未注册简称不猜测，不默认为其他平台。
Registry 对非规范 key、重复 key、空名称及不同平台之间的名称冲突 fail-fast。
既有已登记别称保留；共享 Adapter 不能成为合并两种平台身份的理由。
题号只 trim，大小写、前导零和前缀均保持，不把用户名、URL、Cookie 或其他内容整体转小写。

统一题号 resolver 只对 `Problem.platform + Problem.problemId` 做本地精确匹配。
没有 Carits 内部 UUID 兜底；不检索 `ojBindings`、标题、别名，不调用 Adapter、抓取队列或任何写入。
批量输入按平台/题号成对查询，保留 clientKey 和顺序，避免独立 IN 条件交叉误匹配。
权限仍调用现有 canUseProblem / canViewProblem；无权披露的记录与不存在记录返回相同结果。
有权查看的未发布/归档题返回明确 not_published，数据库错误继续走请求错误路径。

数据库仍是 libraryKey + platform + problemId 唯一，无数据库变更阶段没有修改此约束。
当前平台库与当前组织范围内如果存在多个可访问的相同主身份，返回 identity_conflict；
不优先学校、不 fallback 平台、不选第一条，也不在代码中合并数据。
其他学校或不可访问的记录不参与冲突披露。全局唯一和学校副本转换属于后续迁移。

命中题目的 status=resolved 表达身份可定位且可使用，Stable 元数据可缺省。
Stable 不存在不由 resolver 解释为查无此题。公共 QuickProblemInput 的 requireStable 默认 true。
Contest 和 Assignment 保持这一严格前置条件；题单与 Training 的创建、设计和运行期追加入口
显式使用 requireStable=false，允许先收录已定位的 canonical Problem，再由各领域保存命令按自身
运行条件校验数据槽。原分支为调用方策略加入了 Web 回归断言，但本轮尚未重跑这些测试。
正式保存仍需领域服务重新授权、校验题目状态和数据要求，不能把前端查到当成发布许可。

QuickProblemInput 区分请求失败与未找到；等待业务回调完成，并在失败或部分接受不明时保留输入。
显示“已找到/仍需保存”，不宣称数据已保存。同步 in-flight 锁阻止连续点击重复调用，
会话变化和卸载使旧响应失效，禁用中的表单不接收迟到结果。
已选 ID 快照按 props 记忆化，不在一次渲染里重复消费 Iterable；回包时使用当前快照做重复检查。
localStorage 读写失败不阻断选题；读取旧中文平台偏好时规范化，写入只使用 key。
批量上限仍是 100，但超过时明确报错，不再悄悄截断；输入示例跟随平台变化。
公共回调仍未实现按 clientKey 的完整接受/拒绝回执，不应称为 A09 已完成。

## 本阶段明确未做

- 未连接或修改生产/开发业务数据库，未执行迁移、db push、seed、reset、去重或全量 UPDATE。
- 未修改 Prisma schema、迁移目录、数据库 baseline、全局唯一索引或数据库 CHECK。
- 未转换学校副本，未改题目内部 ID、既有业务引用或不可变历史。
- 未声称所有原始写入路径已规范化；Carits 创建编号和外部题号的完整契约规则仍有后续工作。
- OJ 账号、导入持久化、平台绑定、提交历史等全量写入改造需结合历史冲突审计单独推进。
- 全局主身份唯一、校内派生题新编号、整批事务保存、六处逐行选题与真实浏览器闭环尚未完成。

## 历史验证记录：不得作为当前分支通过凭据

原检索分支记录：本地终端不能解析 GitHub 域名，未得到完整 checkout，也未描述为完整本地构建通过。
共享 Registry 单文件使用 TypeScript 编译后，139 项平台映射/冲突断言通过。
新增选择模型完成 7 项本地运行断言；本地服务与组件只做语法转译。
原分支增加 `.github/workflows/problem-identity-check.yml`：仓库权限只读，不注入业务密钥，
不启动数据库服务，DATABASE_URL 指向本机不可用端口；仅安装依赖、生成 Prisma 客户端类型、
执行类型检查、mocked resolver/contract 单测、Web 单测及静态门禁。
该工作流不执行数据库迁移、seed、reset、部署或推送。

### 具备明确提交标识的历史 CI

实现提交 `c33b43fac5b11165e049157e2cd4aa45469276b0` 的运行：
https://github.com/carits/oi-manager/actions/runs/36377629972

原记录记载结果为 success，并已读取运行步骤和完整 job 日志；本轮保留此历史记录，没有重新核验该运行。

- Prisma 目录与基线零差异检查通过。
- Contracts、Shared 构建通过。
- Server 与 Web 的 TypeScript noEmit 检查通过。
- 本地 resolver/contract 定向单测 15/15 通过。
- Web 单测 54 个文件、359/359 通过，其中平台规范化覆盖 75 项、选择模型覆盖 8 项。
- docs:check、architecture:check、API 身份审计、UI 状态与组件门禁、导航审计通过。
- 数据库 baseline 检查为仓库文件静态检查，没有连接数据库。

### 原记录中的后续远端工作树验证

原文还记载，在当时远端隔离工作树的“最新 HEAD”上运行 Server/Web TypeScript noEmit、
Server/Web production build、本地 resolver/contract 15/15、Web 54 个文件 359/359、docs:check、
UI state check 与 routes:audit 均通过；Web production build 只有既有 lint warning。
该段没有单独绑定提交 SHA，本轮不据此宣称当前或其他后续提交通过。

原验证未执行完整 Server 数据库集成测试或真实浏览器 E2E。
服务端定向测试独立使用 `vitest.problem-selection.config.ts`，不加载数据库测试 setup。
其 fixture 模拟查询返回，权限判断复用 problem.access，capability 解析使用测试替身；
这些不是 PostgreSQL 集成测试，也不能替代后续双学校多角色 E2E。

## 后续迁移前置条件

先只读盘点中文/大小写平台、未知 key、规范化冲突、学校副本和跨表引用，形成批准清单。
不把规范化函数当作已经清理历史数据；存储层仍是中文/旧大小写时，本地精确查询不会自动兜底。
完成冲突处理和恢复演练前，不启用全局唯一约束，不删除学校归属，不更换历史引用。
