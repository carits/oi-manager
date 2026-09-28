export interface ContestProblemBaseline {
  id: string
  problemId: string
  alias?: string | null
  points?: number | null
}

export interface ContestSaveRow {
  id: string
  contestProblemId?: string
}

/** Include order and editable fields, not only membership. This is a preflight
 * safeguard, not a replacement for a server-side revision/transaction boundary. */
export function contestProblemSnapshot(rows: readonly ContestProblemBaseline[]): string {
  return JSON.stringify(rows.map(row => ({
    id: String(row.id), problemId: row.problemId, alias: row.alias || '', points: row.points ?? null,
  })))
}

/** Only a row present in the loaded baseline can express a deletion intent. */
export function contestProblemDeletions(baseline: readonly ContestProblemBaseline[], rows: readonly ContestSaveRow[]): string[] {
  const retained = new Set(rows.flatMap(row => row.contestProblemId ? [String(row.contestProblemId)] : []))
  return baseline.map(row => String(row.id)).filter(id => !retained.has(id))
}

/** Bind every newly returned server ID to its original client row before sorting.
 * Never partition existing/new rows: [old A, new B, old C] must remain A, B, C. */
export function contestProblemOrders(rows: readonly ContestSaveRow[], createdIds: ReadonlyMap<string, string>) {
  const seen = new Set<string>()
  return rows.map((row, orderIndex) => {
    const id = row.contestProblemId || createdIds.get(row.id)
    if (!id) throw new Error('题目尚未取得服务端条目 ID，未发送不完整排序')
    if (seen.has(id)) throw new Error('比赛条目 ID 重复，未发送排序')
    seen.add(id)
    return { id, orderIndex }
  })
}

/** Refuse a partial reorder when another editor changed the collection mid-save. */
export function assertContestProblemMembership(server: readonly ContestProblemBaseline[], orders: readonly { id: string }[]) {
  const expected = new Set(orders.map(order => order.id))
  if (server.length !== expected.size || server.some(row => !expected.has(String(row.id)))) {
    throw new Error('保存期间比赛题目集合已变化，未覆盖新的题目或排序；请核对服务器状态')
  }
}
