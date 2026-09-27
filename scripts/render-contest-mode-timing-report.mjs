import fs from 'node:fs/promises'
import path from 'node:path'

const [inputPath, outputPath] = process.argv.slice(2)
if (!inputPath || !outputPath) {
  throw new Error('Usage: node scripts/render-contest-mode-timing-report.mjs <input.json> <output.md>')
}

const raw = JSON.parse(await fs.readFile(inputPath, 'utf8'))
if (!Array.isArray(raw.roundResults) || raw.roundResults.length !== raw.rounds || !raw.aggregate) {
  throw new Error(`Benchmark is incomplete: expected ${raw.rounds} rounds, found ${raw.roundResults?.length || 0}`)
}

const numbers = values => values.map(Number).filter(Number.isFinite)
const mean = values => {
  const selected = numbers(values)
  return selected.length ? Math.round(selected.reduce((sum, value) => sum + value, 0) / selected.length) : null
}
const formatMs = value => value == null ? '—' : `${Number(value).toLocaleString('zh-CN')} ms`
const resultLabels = {
  accepted: 'Accepted',
  wa: 'Wrong Answer',
  tle: 'Time Limit Exceeded',
  mle: 'Memory Limit Exceeded',
  re: 'Runtime Error',
  ce: 'Compile Error',
  pe: 'Presentation Error',
  ole: 'Output Limit Exceeded',
  system_error: 'System Error',
}
const formatResult = record => resultLabels[record.result]
  || record.result.replaceAll('_', ' ').replace(/\b\w/g, char => char.toUpperCase())

const pairObservations = raw.roundResults.flatMap(round => round.pairs)
const byPair = new Map()
for (const pair of pairObservations) {
  const entries = byPair.get(pair.key) || []
  entries.push(pair)
  byPair.set(pair.key, entries)
}

const pairRows = [...byPair.values()].map(entries => {
  const first = entries[0]
  return {
    username: first.username,
    problemOrderIndex: first.problemOrderIndex,
    problemAlias: first.problemAlias,
    acmResult: formatResult(first.acm),
    ioiResult: `${formatResult(first.ioi)} / ${Number(first.ioi.score)}`,
    acmExecutedCases: mean(entries.map(item => item.acm.executedCases)),
    ioiExecutedCases: mean(entries.map(item => item.ioi.executedCases)),
    acmCaseWallMs: mean(entries.map(item => item.acm.caseWallSumMs)),
    ioiCaseWallMs: mean(entries.map(item => item.ioi.caseWallSumMs)),
    acmObservedMs: mean(entries.map(item => item.acm.observedCompletionMs)),
    ioiObservedMs: mean(entries.map(item => item.ioi.observedCompletionMs)),
  }
}).sort((left, right) => left.problemOrderIndex - right.problemOrderIndex || left.username.localeCompare(right.username))

const problemRows = []
for (const problemOrderIndex of [...new Set(pairRows.map(row => row.problemOrderIndex))].sort((a, b) => a - b)) {
  const pairs = pairObservations.filter(pair => pair.problemOrderIndex === problemOrderIndex)
  problemRows.push({
    alias: pairs[0]?.problemAlias || String.fromCharCode(65 + problemOrderIndex),
    uniquePairs: new Set(pairs.map(pair => pair.key)).size,
    acmCaseWallMs: mean(pairs.map(pair => pair.acm.caseWallSumMs)),
    ioiCaseWallMs: mean(pairs.map(pair => pair.ioi.caseWallSumMs)),
    acmObservedMs: mean(pairs.map(pair => pair.acm.observedCompletionMs)),
    ioiObservedMs: mean(pairs.map(pair => pair.ioi.observedCompletionMs)),
    inconsistencies: pairs.filter(pair => (pair.acm.result === 'accepted') !== (pair.ioi.result === 'accepted' && Number(pair.ioi.score) === 100)).length,
  })
}

const rawRelativePath = `data/${path.basename(inputPath)}`
const roundRows = raw.roundResults.map(round => `| ${round.round} | ${formatMs(round.elapsedMs)} | ${round.summary.pairCount} | ${round.summary.resultInconsistencyCount} | ${formatMs(round.summary.byMode.acm.caseWallSumMs.median)} | ${formatMs(round.summary.byMode.ioi.caseWallSumMs.median)} | ${formatMs(round.summary.byMode.acm.observedCompletionMs.median)} | ${formatMs(round.summary.byMode.ioi.observedCompletionMs.median)} |`).join('\n')
const problemTable = problemRows.map(row => `| ${row.alias} | ${row.uniquePairs} | ${formatMs(row.acmCaseWallMs)} | ${formatMs(row.ioiCaseWallMs)} | ${formatMs(row.acmObservedMs)} | ${formatMs(row.ioiObservedMs)} | ${row.inconsistencies} |`).join('\n')
const pairTable = pairRows.map(row => `| ${row.username} | ${row.problemAlias} | ${row.acmResult} | ${row.ioiResult} | ${row.acmExecutedCases} / ${row.ioiExecutedCases} | ${formatMs(row.acmCaseWallMs)} | ${formatMs(row.ioiCaseWallMs)} | ${formatMs(row.acmObservedMs)} | ${formatMs(row.ioiObservedMs)} |`).join('\n')

const markdown = `---
status: current
audience: development, operations
last_verified: 2026-08-27
source_of_truth: ${rawRelativePath}
---

# 20260815 ACM / IOI 同源提交三轮耗时报告

## 结论

- 比较对象为比赛 1157（ACM/ICPC）与 1158（IOI）中用户名、题目顺序和源代码 SHA-256 完全相同的提交。
- 每轮配对 ${raw.aggregate.uniquePairs} 组，三轮共 ${raw.aggregate.pairObservations} 个配对观测；Accepted/100 语义不一致观测为 ${raw.aggregate.resultInconsistencyObservations}。
- ACM 会在首个失败测试点后 Fast-Fail；IOI 为计算完整分数会继续执行全部需要的测试点。因此错误程序的 IOI 测试点耗时通常显著高于 ACM，这是赛制执行语义差异，不是测试数据不同。
- Accepted 同源代码两边都会执行全部测试点，三轮原始结果和逐用户逐题均保存在[原始 JSON](${rawRelativePath})。

## 方法

1. 同时对 1157 和 1158 的全部本地提交执行整场重测；每场 89 条，共 178 条。
2. 从整场重测请求完成开始，每 500ms 读取一次终态，记录“排队 + 编译 + Judge”的观测完成时间。
3. 完成后逐条读取提交详情，汇总实际执行测试点数量、case CPU 总和、case wall 总和与最大单点时间。
4. 使用用户名、题目顺序和代码 SHA-256 配对，拒绝仅按远程 ID、提交顺序或用户名猜测对应关系。
5. 连续执行 ${raw.rounds} 轮；报告中的逐用户逐题时间为三轮算术平均。

“观测完成时间”包含队列位置，适合观察整场吞吐，不等同于一条程序独占 Judge 时的运行时间；比较单份代码本身应优先看 case wall/CPU 指标。

## 每轮汇总

| 轮次 | 整轮耗时 | 配对数 | 结果不一致 | ACM case wall 中位数 | IOI case wall 中位数 | ACM 观测完成中位数 | IOI 观测完成中位数 |
|---:|---:|---:|---:|---:|---:|---:|---:|
${roundRows}

三轮整轮耗时：中位数 ${formatMs(raw.aggregate.roundElapsedMs.median)}，P95 ${formatMs(raw.aggregate.roundElapsedMs.p95)}。

## 按题目汇总

| 题目 | 唯一代码对 | ACM case wall 平均 | IOI case wall 平均 | ACM 观测完成平均 | IOI 观测完成平均 | 结果不一致观测 |
|---|---:|---:|---:|---:|---:|---:|
${problemTable}

## 逐用户逐题明细

| 用户 | 题目 | ACM 结果 | IOI 结果/分数 | 平均执行点 ACM/IOI | ACM case wall 平均 | IOI case wall 平均 | ACM 观测完成平均 | IOI 观测完成平均 |
|---|---|---|---|---:|---:|---:|---:|---:|
${pairTable}

## 解释边界

- 两场活动分别持有自己的 Stable Reader；本报告验证的是同一 Stable 数据在 ACM Fast-Fail 与 IOI SUM 计分下的执行差异。
- IOI 的最终 Verdict 仍反映最严重失败状态，分数由 Official Group 的 \`sum\` 聚合计算；ACM 只使用 0/100 与最终 Verdict。
- 本报告在当前单台开发预览服务器、当前 Judge 并发与当时系统负载下生成，不作为生产容量承诺。
`

await fs.mkdir(path.dirname(outputPath), { recursive: true })
await fs.writeFile(outputPath, markdown)
console.log(JSON.stringify({ outputPath, uniquePairs: pairRows.length, rounds: raw.roundResults.length }, null, 2))
