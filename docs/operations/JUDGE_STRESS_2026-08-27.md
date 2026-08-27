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

## 并发一致性结果

- 100 个并发首次调用共享唯一 initial Revision；没有瞬时 409、重复 Revision 或 `.pending` 目录。
- 100 个并发发布者以同一 expected Revision 执行 CAS：恰好 1 个成功、99 个得到预期冲突，最新版指针与文件目录一致。
- 10 个 Hack 结果同时晋升：恰好 1 个生成新 Revision，其余安全重排；重复输入重试成为 `redundant`，不增加 Revision、Testcase 或文件。
- 500 个相同系统程序并发获取缓存：底层只编译一次，引用计数达到 500 后回到 0，dispose 后产物只删除一次。

## 尚未由本报告证明的范围

- 比赛范围重测和普通提交同时更新同一记录。
- Test Graph 保存与 Hack 晋升的真实进程级竞争。
- 两个真实 API 实例同时执行 finalization。
- 单提交 P50/P95/P99 延迟；当前只记录每轮和总吞吐。

这些项目继续保留在 `REMAINING_WORK_2026-08-27.md`，不能用本报告代替其后续证据。
