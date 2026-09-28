---
status: reference
audience: development, operations
last_verified: 2026-08-27
source_of_truth: data/20260815-mode-timing-3rounds-20260827.json
---

# 20260815 ACM / IOI 同源提交三轮耗时报告

> 历史性能报告：提交耗时数据仍可用于比较 ACM/OI 执行差异，但其中固定 TestSet Revision 的说明
> 不代表当前双槽模型。当前 Contest 使用 Stable Reader，不存在 Revision ID。

## 结论

- 比较对象为比赛 1157（ACM/ICPC）与 1158（IOI）中用户名、题目顺序和源代码 SHA-256 完全相同的提交。
- 每轮配对 89 组，三轮共 267 个配对观测；Accepted/100 语义不一致观测为 0。
- ACM 会在首个失败测试点后 Fast-Fail；IOI 为计算完整分数会继续执行全部需要的测试点。因此错误程序的 IOI 测试点耗时通常显著高于 ACM，这是赛制执行语义差异，不是测试数据不同。
- Accepted 同源代码两边都会执行全部测试点，三轮原始结果和逐用户逐题均保存在[原始 JSON](data/20260815-mode-timing-3rounds-20260827.json)。

## 方法

1. 同时对 1157 和 1158 的全部本地提交执行整场重测；每场 89 条，共 178 条。
2. 从整场重测请求完成开始，每 500ms 读取一次终态，记录“排队 + 编译 + Judge”的观测完成时间。
3. 完成后逐条读取提交详情，汇总实际执行测试点数量、case CPU 总和、case wall 总和与最大单点时间。
4. 使用用户名、题目顺序和代码 SHA-256 配对，拒绝仅按远程 ID、提交顺序或用户名猜测对应关系。
5. 连续执行 3 轮；报告中的逐用户逐题时间为三轮算术平均。

“观测完成时间”包含队列位置，适合观察整场吞吐，不等同于一条程序独占 Judge 时的运行时间；比较单份代码本身应优先看 case wall/CPU 指标。

## 每轮汇总

| 轮次 | 整轮耗时 | 配对数 | 结果不一致 | ACM case wall 中位数 | IOI case wall 中位数 | ACM 观测完成中位数 | IOI 观测完成中位数 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 776,358 ms | 89 | 0 | 22 ms | 2,053 ms | 338,896 ms | 347,381 ms |
| 2 | 773,414 ms | 89 | 0 | 20 ms | 2,023 ms | 342,739 ms | 351,378 ms |
| 3 | 782,947 ms | 89 | 0 | 23 ms | 2,109 ms | 346,704 ms | 356,631 ms |

三轮整轮耗时：中位数 776,358 ms，P95 782,947 ms。

## 按题目汇总

| 题目 | 唯一代码对 | ACM case wall 平均 | IOI case wall 平均 | ACM 观测完成平均 | IOI 观测完成平均 | 结果不一致观测 |
|---|---:|---:|---:|---:|---:|---:|
| A | 23 | 234 ms | 258 ms | 349,353 ms | 353,874 ms | 0 |
| B | 22 | 790 ms | 3,955 ms | 372,643 ms | 381,200 ms | 0 |
| C | 22 | 20 ms | 7,459 ms | 351,815 ms | 367,948 ms | 0 |
| D | 22 | 300 ms | 2,260 ms | 360,875 ms | 370,834 ms | 0 |

## 逐用户逐题明细

| 用户 | 题目 | ACM 结果 | IOI 结果/分数 | 平均执行点 ACM/IOI | ACM case wall 平均 | IOI case wall 平均 | ACM 观测完成平均 | IOI 观测完成平均 |
|---|---|---|---|---:|---:|---:|---:|---:|
| oi20260815_01 | A | Accepted | Accepted / 100 | 20 / 20 | 167 ms | 177 ms | 6,198 ms | 5,957 ms |
| oi20260815_02 | A | Accepted | Accepted / 100 | 20 / 20 | 215 ms | 215 ms | 32,148 ms | 35,289 ms |
| oi20260815_04 | A | Accepted | Accepted / 100 | 20 / 20 | 195 ms | 205 ms | 51,997 ms | 56,965 ms |
| oi20260815_05 | A | Accepted | Accepted / 100 | 20 / 20 | 216 ms | 209 ms | 84,452 ms | 85,737 ms |
| oi20260815_06 | A | Accepted | Accepted / 100 | 20 / 20 | 202 ms | 199 ms | 113,479 ms | 118,245 ms |
| oi20260815_07 | A | Accepted | Accepted / 100 | 20 / 20 | 329 ms | 405 ms | 146,057 ms | 151,669 ms |
| oi20260815_08 | A | Accepted | Accepted / 100 | 20 / 20 | 232 ms | 224 ms | 185,085 ms | 189,556 ms |
| oi20260815_09 | A | Accepted | Accepted / 100 | 20 / 20 | 294 ms | 400 ms | 212,362 ms | 217,408 ms |
| oi20260815_10 | A | Accepted | Accepted / 100 | 20 / 20 | 245 ms | 221 ms | 244,807 ms | 247,818 ms |
| oi20260815_11 | A | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 11 ms | 221 ms | 273,472 ms | 278,853 ms |
| oi20260815_12 | A | Accepted | Accepted / 100 | 20 / 20 | 185 ms | 240 ms | 299,989 ms | 305,606 ms |
| oi20260815_13 | A | Accepted | Accepted / 100 | 20 / 20 | 211 ms | 208 ms | 336,896 ms | 337,886 ms |
| oi20260815_14 | A | Accepted | Accepted / 100 | 20 / 20 | 378 ms | 442 ms | 367,847 ms | 373,047 ms |
| oi20260815_15 | A | Accepted | Accepted / 100 | 20 / 20 | 214 ms | 222 ms | 405,369 ms | 410,649 ms |
| oi20260815_16 | A | Accepted | Accepted / 100 | 20 / 20 | 218 ms | 198 ms | 441,639 ms | 444,159 ms |
| oi20260815_17 | A | Accepted | Accepted / 100 | 20 / 20 | 168 ms | 172 ms | 474,094 ms | 478,677 ms |
| oi20260815_18 | A | Accepted | Accepted / 100 | 20 / 20 | 190 ms | 236 ms | 518,743 ms | 524,316 ms |
| oi20260815_19 | A | Accepted | Accepted / 100 | 20 / 20 | 442 ms | 370 ms | 561,164 ms | 567,759 ms |
| oi20260815_20 | A | Accepted | Accepted / 100 | 20 / 20 | 219 ms | 206 ms | 600,232 ms | 603,348 ms |
| oi20260815_21 | A | Accepted | Accepted / 100 | 20 / 20 | 421 ms | 431 ms | 611,286 ms | 616,477 ms |
| oi20260815_22 | A | Accepted | Accepted / 100 | 20 / 20 | 218 ms | 255 ms | 647,838 ms | 656,355 ms |
| oi20260815_23 | A | Accepted | Accepted / 100 | 20 / 20 | 212 ms | 217 ms | 690,266 ms | 695,124 ms |
| oi20260815_24 | A | Accepted | Accepted / 100 | 20 / 20 | 198 ms | 255 ms | 729,691 ms | 738,201 ms |
| oi20260815_01 | B | Wrong Answer | Wrong Answer / 80 | 2 / 20 | 24 ms | 2,193 ms | 10,983 ms | 16,787 ms |
| oi20260815_04 | B | Wrong Answer | Wrong Answer / 30 | 2 / 20 | 22 ms | 2,817 ms | 57,860 ms | 68,308 ms |
| oi20260815_05 | B | Accepted | Accepted / 100 | 20 / 20 | 2,048 ms | 2,017 ms | 95,129 ms | 96,895 ms |
| oi20260815_06 | B | Accepted | Accepted / 100 | 20 / 20 | 2,222 ms | 2,169 ms | 124,344 ms | 128,421 ms |
| oi20260815_07 | B | Accepted | Accepted / 100 | 20 / 20 | 2,167 ms | 2,147 ms | 159,398 ms | 161,980 ms |
| oi20260815_08 | B | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 15 ms | 2,234 ms | 190,285 ms | 200,481 ms |
| oi20260815_09 | B | Wrong Answer | Wrong Answer / 15 | 1 / 20 | 10 ms | 2,176 ms | 217,656 ms | 227,845 ms |
| oi20260815_10 | B | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 10 ms | 4,918 ms | 249,874 ms | 261,274 ms |
| oi20260815_11 | B | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 9 ms | 228 ms | 279,812 ms | 287,954 ms |
| oi20260815_12 | B | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 7 ms | 4,456 ms | 306,058 ms | 318,651 ms |
| oi20260815_13 | B | Wrong Answer | Wrong Answer / 30 | 2 / 20 | 22 ms | 5,124 ms | 342,780 ms | 351,797 ms |
| oi20260815_14 | B | Accepted | Accepted / 100 | 20 / 20 | 2,031 ms | 2,030 ms | 382,194 ms | 383,365 ms |
| oi20260815_15 | B | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 8 ms | 4,690 ms | 412,480 ms | 423,631 ms |
| oi20260815_16 | B | Accepted | Accepted / 100 | 20 / 20 | 2,072 ms | 2,122 ms | 452,666 ms | 454,893 ms |
| oi20260815_17 | B | Time Limit Exceeded | Time Limit Exceeded / 0 | 1 / 20 | 1,303 ms | 24,869 ms | 483,711 ms | 511,976 ms |
| oi20260815_18 | B | Wrong Answer | Wrong Answer / 40 | 3 / 20 | 142 ms | 2,585 ms | 525,754 ms | 535,850 ms |
| oi20260815_19 | B | Wrong Answer | Wrong Answer / 40 | 3 / 20 | 257 ms | 4,403 ms | 573,741 ms | 583,372 ms |
| oi20260815_20 | B | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 10 ms | 2,315 ms | 605,832 ms | 614,361 ms |
| oi20260815_21 | B | Wrong Answer | Wrong Answer / 40 | 3 / 20 | 202 ms | 2,839 ms | 620,777 ms | 628,312 ms |
| oi20260815_22 | B | Accepted | Accepted / 100 | 20 / 20 | 2,730 ms | 2,762 ms | 664,591 ms | 669,217 ms |
| oi20260815_23 | B | Accepted | Accepted / 100 | 20 / 20 | 2,048 ms | 1,979 ms | 704,009 ms | 707,597 ms |
| oi20260815_24 | B | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 13 ms | 5,938 ms | 738,201 ms | 753,436 ms |
| oi20260815_01 | C | Runtime Error | Runtime Error / 0 | 1 / 20 | 26 ms | 1,250 ms | 16,326 ms | 26,780 ms |
| oi20260815_02 | C | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 16 ms | 3,185 ms | 37,540 ms | 47,423 ms |
| oi20260815_04 | C | Wrong Answer | Time Limit Exceeded / 0 | 1 / 20 | 9 ms | 9,544 ms | 62,811 ms | 80,376 ms |
| oi20260815_05 | C | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 18 ms | 2,117 ms | 99,593 ms | 107,749 ms |
| oi20260815_06 | C | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 16 ms | 2,699 ms | 130,254 ms | 141,749 ms |
| oi20260815_07 | C | Wrong Answer | Runtime Error / 0 | 1 / 20 | 153 ms | 8,198 ms | 164,504 ms | 179,268 ms |
| oi20260815_08 | C | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 8 ms | 2,065 ms | 195,369 ms | 205,788 ms |
| oi20260815_09 | C | Wrong Answer | Time Limit Exceeded / 10 | 1 / 20 | 9 ms | 10,228 ms | 222,974 ms | 242,031 ms |
| oi20260815_10 | C | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 12 ms | 6,084 ms | 254,554 ms | 268,709 ms |
| oi20260815_11 | C | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 13 ms | 228 ms | 285,045 ms | 294,074 ms |
| oi20260815_12 | C | Wrong Answer | Runtime Error / 0 | 1 / 20 | 9 ms | 12,629 ms | 310,897 ms | 331,583 ms |
| oi20260815_13 | C | Wrong Answer | Wrong Answer / 15 | 1 / 20 | 12 ms | 5,467 ms | 347,299 ms | 361,641 ms |
| oi20260815_14 | C | Wrong Answer | Runtime Error / 0 | 1 / 20 | 14 ms | 14,086 ms | 387,741 ms | 406,968 ms |
| oi20260815_15 | C | Wrong Answer | Runtime Error / 0 | 1 / 20 | 11 ms | 13,249 ms | 417,054 ms | 438,434 ms |
| oi20260815_16 | C | Wrong Answer | Time Limit Exceeded / 0 | 1 / 20 | 12 ms | 13,413 ms | 457,754 ms | 477,226 ms |
| oi20260815_17 | C | Wrong Answer | Time Limit Exceeded / 5 | 1 / 20 | 12 ms | 10,050 ms | 488,702 ms | 507,304 ms |
| oi20260815_18 | C | Wrong Answer | Time Limit Exceeded / 0 | 1 / 20 | 13 ms | 12,617 ms | 530,854 ms | 552,691 ms |
| oi20260815_19 | C | Wrong Answer | Runtime Error / 0 | 1 / 20 | 9 ms | 10,628 ms | 578,326 ms | 597,231 ms |
| oi20260815_21 | C | Wrong Answer | Wrong Answer / 5 | 1 / 20 | 18 ms | 6,325 ms | 626,519 ms | 650,923 ms |
| oi20260815_22 | C | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 12 ms | 2,528 ms | 669,804 ms | 683,464 ms |
| oi20260815_23 | C | Wrong Answer | Runtime Error / 5 | 1 / 20 | 11 ms | 2,033 ms | 710,822 ms | 723,244 ms |
| oi20260815_24 | C | Wrong Answer | Runtime Error / 0 | 1 / 20 | 17 ms | 15,463 ms | 745,195 ms | 770,197 ms |
| oi20260815_01 | D | Wrong Answer | Wrong Answer / 25 | 2 / 20 | 26 ms | 526 ms | 21,320 ms | 29,722 ms |
| oi20260815_02 | D | Wrong Answer | Wrong Answer / 35 | 1 / 20 | 11 ms | 2,122 ms | 42,002 ms | 51,163 ms |
| oi20260815_04 | D | Wrong Answer | Runtime Error / 25 | 1 / 20 | 12 ms | 985 ms | 71,498 ms | 79,250 ms |
| oi20260815_05 | D | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 12 ms | 574 ms | 104,095 ms | 112,486 ms |
| oi20260815_06 | D | Time Limit Exceeded | Runtime Error / 15 | 1 / 20 | 1,202 ms | 4,697 ms | 136,567 ms | 149,071 ms |
| oi20260815_07 | D | Accepted | Accepted / 100 | 20 / 20 | 1,398 ms | 1,334 ms | 173,518 ms | 184,000 ms |
| oi20260815_08 | D | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 10 ms | 206 ms | 204,830 ms | 212,346 ms |
| oi20260815_09 | D | Wrong Answer | Wrong Answer / 35 | 1 / 20 | 20 ms | 607 ms | 231,757 ms | 239,739 ms |
| oi20260815_10 | D | Wrong Answer | Wrong Answer / 35 | 1 / 20 | 9 ms | 2,065 ms | 265,441 ms | 274,482 ms |
| oi20260815_11 | D | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 9 ms | 194 ms | 292,811 ms | 300,714 ms |
| oi20260815_12 | D | Wrong Answer | Wrong Answer / 35 | 1 / 20 | 12 ms | 2,547 ms | 322,435 ms | 332,055 ms |
| oi20260815_13 | D | Accepted | Accepted / 100 | 20 / 20 | 2,197 ms | 2,508 ms | 361,183 ms | 371,474 ms |
| oi20260815_14 | D | Wrong Answer | Wrong Answer / 85 | 12 / 20 | 197 ms | 1,175 ms | 392,541 ms | 400,548 ms |
| oi20260815_15 | D | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 16 ms | 1,931 ms | 427,528 ms | 436,334 ms |
| oi20260815_16 | D | Wrong Answer | Wrong Answer / 35 | 1 / 20 | 12 ms | 487 ms | 462,308 ms | 469,747 ms |
| oi20260815_17 | D | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 13 ms | 612 ms | 511,998 ms | 519,928 ms |
| oi20260815_18 | D | Time Limit Exceeded | Runtime Error / 10 | 1 / 20 | 1,402 ms | 18,482 ms | 542,616 ms | 570,195 ms |
| oi20260815_19 | D | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 9 ms | 640 ms | 586,835 ms | 595,100 ms |
| oi20260815_21 | D | Wrong Answer | Wrong Answer / 10 | 1 / 20 | 10 ms | 570 ms | 633,416 ms | 641,869 ms |
| oi20260815_22 | D | Wrong Answer | Wrong Answer / 40 | 1 / 20 | 8 ms | 2,110 ms | 677,078 ms | 688,608 ms |
| oi20260815_23 | D | Wrong Answer | Wrong Answer / 0 | 1 / 20 | 13 ms | 3,086 ms | 717,856 ms | 729,691 ms |
| oi20260815_24 | D | Wrong Answer | Wrong Answer / 25 | 1 / 20 | 9 ms | 2,254 ms | 759,623 ms | 769,825 ms |

## 解释边界

- 两场活动分别固定自己的不可变 TestSet Revision；本报告验证的是同源官方测试数据在 ACM Fast-Fail 与 IOI SUM 计分下的执行差异。
- IOI 的最终 Verdict 仍反映最严重失败状态，分数由 Official Group 的 `sum` 聚合计算；ACM 只使用 0/100 与最终 Verdict。
- 本报告在当前单台开发预览服务器、当前 Judge 并发与当时系统负载下生成，不作为生产容量承诺。
