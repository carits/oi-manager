---
status: current
audience: development, operations
last_verified: 2026-08-27
source_of_truth: e2e/stress/judge-load.spec.ts, isolated e2e database schema, isolated go-judge runtime report
---

# Judge 长稳与并发一致性报告（2026-08-27）

## 隔离边界

- 数据库仅使用 `schema=e2e`；启动脚本对其他 Schema fail-closed。
- API 使用 `127.0.0.1:3112`，go-judge 使用 `127.0.0.1:15050`。
- 沙箱容器、Server 和 Judge 进程由测试脚本持有并在成功、失败、INT 或 TERM 后清理。
- 压测不访问或修改生产提交、比赛排名与正式测试数据。

## 真实长稳结果

| 项目 | 结果 |
| --- | --- |
| 轮次 | 30 |
| 每轮提交 | 100 |
| 总提交 | 3000 |
| Accepted | 3000 |
| 失败或卡住 | 0 |
| 总时长 | 1747.722 秒 |
| 平均吞吐 | 1.72 条/秒 |
| 单轮吞吐范围 | 1.66–1.79 条/秒 |
| go-judge 文件数 | 0 → 0 |
| API RSS | 97104KB → 88540KB（-8564KB） |
| Judge RSS | 97236KB → 88616KB（-8620KB） |

每轮均独立创建 100 条源码略有差异的本地提交，轮询到明确终态，并断言全部为 `Accepted/100`、不存在残留 Queuing/Judging 记录且 go-judge 文件清单回到 0。

随后使用候选容器边界再次运行 10 条真实提交，配置包含只读根文件系统、`no-new-privileges`、1536MB 内存、1.5 CPU、256 PID、65536 NOFILE 和 512MB 临时目录，结果为 10/10 Accepted 且清理完成。宿主内核未启用 swap accounting，因此 Docker 只能强制内存上限，不能独立强制 memory+swap 上限；该限制必须保留在运维说明中。

## 逐提交延迟补测

2026-08-27 23:48 在相同隔离栈中再次执行 1 轮 100 条真实提交。压力工具从每条 HTTP 提交成功的时刻开始计时，到列表接口首次观测到明确终态为止，因此结果包含排队、编译、沙箱执行、结果回传和轮询观测时间。

| 项目 | 结果 |
| --- | --- |
| 提交 | 100 |
| Accepted | 100 |
| 总时长 | 57.766 秒 |
| 吞吐 | 1.73 条/秒 |
| 最小延迟 | 6097ms |
| P50 | 29990ms |
| P95 | 50925ms |
| P99 | 52932ms |
| 最大延迟 | 52945ms |
| API / Judge RSS 增量 | 0KB / 0KB |
| go-judge 文件数 | 0 → 0 |

`scripts/run-isolated-judge-stress.sh` 已固定只收集 `judge-load.spec.ts`；蓝绿演练继续由独立的 `test:stress:blue-green` 命令执行，不再因缺少蓝绿专用 `stack.json` 产生无关失败。

## 并发一致性结果

- 100 个并发首次调用共享唯一 initial Revision；没有瞬时 409、重复 Revision 或 `.pending` 目录。
- 100 个并发发布者以同一 expected Revision 执行 CAS：恰好 1 个成功、99 个得到预期冲突，最新版指针与文件目录一致。
- 10 个 Hack 结果同时晋升：恰好 1 个生成新 Revision，其余安全重排；重复输入重试成为 `redundant`，不增加 Revision、Testcase 或文件。
- 500 个相同系统程序并发获取缓存：底层只编译一次，引用计数达到 500 后回到 0，dispose 后产物只删除一次。
- 比赛题目范围的 20 个并发重测请求与 1 个普通提交同时执行：原有 3 条终态记录合计只重置一次，新提交保持为第 4 条队列记录；重测与 Judge 终态竞争后只允许 `accepted` 或重新排队，旧 Judge 回传不能覆盖最终状态。
- OI Test Graph 保存与 Hack 晋升同时执行：数据库锁和 Revision CAS 只允许一个下一 Revision，失败方得到 `TEST_GRAPH_STALE` 或 Hack 安全重排；没有半成品文件或重复 Testcase。连同冲突后重试去重共 5/5 通过。
- 两个真实 API 实例同时执行 100 个 finalization：同一 Submission/Hack 只落库一次，成绩同步只发生一次；该证据由独立蓝绿 E2E 提供。

本报告计划覆盖的长稳、延迟、重测竞争、Test Graph/Hack 竞争、双 API finalization 和缓存生命周期均已有可重复证据。外部服务故障注入、异机日志和整机恢复仍由 `REMAINING_WORK_2026-08-27.md` 单独跟踪。
