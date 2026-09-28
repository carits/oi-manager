---
status: current
audience: development
last_verified: 2026-09-28
source_of_truth: packages/shared/src/oj-platforms.ts, packages/contracts/src/problem-selection.ts, apps/server/src/modules/problem-selection/problem-selection.service.ts
---

# 题目主身份与纯本地检索：无数据库变更阶段

分支：`codex/problem-identity-local-lookup`。起点：`f04b0aa5`。
本记录描述分支代码，不代表已合并、部署、完成数据库清理或完成整套管理改造。

## 2026-09-28 变更记录

平台名称通过共享 Registry 的 key、displayName 和显式 aliases 精确映射成英文小写 key。
中文显示名也能在数据边界被识别；未注册简称不猜测，不默认为其他平台。
Registry 对非规范 key、重复 key、空名称及不同平台之间的名称冲突 fail-fast。
既有已登记别称保留；共享 Adapter 不能成为合并两种平台身份的理由。
题号只 trim，大小写、前导零和前缀均保持，不把用户名、URL、Cookie 或其他内容整体转小写。

统一题号 resolver 只对 `Problem.platform + Problem.problemId` 做本地精确匹配。
移除 Carits 内部 UUID 兜底；不检索 `ojBindings`、标题、别名，不调用 Adapter、抓取队列或任何写入。
批量输入按平台/题号成对查询，保留 clientKey 和顺序，避免独立 IN 条件交叉误匹配。
权限仍调用现有 canUseProblem / canViewProblem；无权披露的记录与不存在记录返回相同结果。
有权查看的未发布/归档题返回明确 not_published，数据库错误继续走请求错误路径。

数据库仍是 libraryKey + platform + problemId 唯一，本批没有修改此约束。
当前平台库与当前组织范围内如果存在多个可访问的相同主身份，返回 identity_conflict；
不优先学校、不 fallback 平台、不选第一条，也不在代码中合并数据。
其他学校或不可访问的记录不参与冲突披露。全局唯一和学校副本转换属于后续迁移。

命中题目的 status=resolved 表达身份可定位且可使用，Stable 元数据可缺省。
Stable 不存在不再由 resolver 解释为查无此题。公共 QuickProblemInput 的 requireStable 默认 true，
暂时保留旧业务入口的评测前置条件；requireStable=false 的纯收录策略已可测试，但题单等调用方
尚未在本阶段逐页切换，不能宣称题单无 Stable 的全链路已完成。
正式保存仍需领域服务重新授权、校验题目状态和数据要求，不能把前端查到当成发布许可。

QuickProblemInput 区分请求失败与未找到；等待业务回调完成，并在失败或部分接受不明时保留输入。
显示“已找到/仍需保存”，不宣称数据已保存。同步 in-flight 锁阻止连续点击重复调用，
会话变化和卸载使旧响应失效，禁用中的表单不接收迟到结果。
localStorage 读写失败不阻断选题；读取旧中文平台偏好时规范化，写入只使用 key。
批量上限仍是 100，但超过时明确报错，不再悄悄截断；输入示例跟随平台变化。

## 明确未做

- 未连接或修改生产/开发业务数据库，未执行任何迁移、db push、seed、reset、去重或全量 UPDATE。
- 未修改 Prisma schema、迁移目录、数据库 baseline、全局唯一索引或数据库 CHECK。
- 未转换现有学校副本，未改题目内部 ID、既有业务引用或不可变历史。
- 未声称所有原始写入路径已规范化；创建/更新题目仍需后续显式主身份与 ojBindings 解耦。
- OJ 账号、导入持久化、平台绑定、提交历史等全量写入改造需结合历史冲突审计单独推进。
- 全局主身份唯一、校内派生题新编号、整批事务保存、五类入口的逐行编辑表与真实浏览器闭环尚未完成。

## 验证

本地终端不能解析 GitHub 域名，未得到完整 checkout，也未将其描述为完整本地构建通过。
共享 Registry 单文件使用 TypeScript 编译后，139 项平台映射/冲突断言通过。
新增选择模型完成 7 项本地运行断言；服务与组件仅完成语法转译检查，不等于全项目类型检查。
分支增加 `.github/workflows/problem-identity-check.yml`：只读仓库权限，不使用密钥，
不启动数据库服务，DATABASE_URL 指向本机不可用端口；仅安装依赖、生成 Prisma 客户端类型、
执行类型检查、mocked resolver/contract 单测、Web 单测及静态门禁。
该工作流不执行数据库迁移、seed、reset、部署或推送。最终检查结果必须读取本分支实际运行，不能仅凭工作流存在宣称通过。

服务端定向测试独立使用 `vitest.problem-selection.config.ts`，不加载数据库测试 setup。
其 fixture 模拟查询返回，权限判断复用 problem.access，capability 解析使用测试替身；
这些不是 PostgreSQL 集成测试，也不能替代后续双学校多角色 E2E。

## 后续迁移前置条件

先只读盘点中文/大小写平台、未知 key、规范化冲突、学校副本和跨表引用，形成批准清单。
不把本次规范化函数当作已经清理历史数据；存储层仍是中文/旧大小写时，本地精确查询不会自动兜底。
完成冲突处理和恢复演练前，不启用全局唯一约束，不删除学校归属，不更换历史引用。
