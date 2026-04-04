/**
 * glossary.ts — 术语表加载与合并
 *
 * 三级合并优先级：用户自定义 > 项目配置 > 平台默认
 */

import type { Platform } from './types'

// ===== 平台默认术语表 =====

/** 中文→英文 默认术语 */
const ZH_TO_EN: Record<string, string> = {
  '子序列': 'subsequence',
  '子串': 'substring',
  '子数组': 'subarray',
  '排列': 'permutation',
  '字典序': 'lexicographical order',
  '连通块': 'connected component',
  '生成树': 'spanning tree',
  '最短路': 'shortest path',
  '最小生成树': 'minimum spanning tree',
  '最大流': 'maximum flow',
  '二分图': 'bipartite graph',
  '有向图': 'directed graph',
  '无向图': 'undirected graph',
  '树形图': 'arborescence',
  '前缀和': 'prefix sum',
  '差分': 'difference array',
  '线段树': 'segment tree',
  '树状数组': 'binary indexed tree',
  '平衡树': 'balanced tree',
  '红黑树': 'red-black tree',
  '并查集': 'disjoint set union',
  '拓扑排序': 'topological sort',
  '欧拉回路': 'Eulerian circuit',
  '哈密顿回路': 'Hamiltonian cycle',
  '动态规划': 'dynamic programming',
  '贪心': 'greedy',
  '分治': 'divide and conquer',
  '回溯': 'backtracking',
  '二分查找': 'binary search',
  '深度优先搜索': 'depth-first search',
  '广度优先搜索': 'breadth-first search',
  '记忆化搜索': 'memoized search',
  '状态压缩': 'state compression',
  '数论': 'number theory',
  '组合数学': 'combinatorics',
  '概率论': 'probability theory',
  '博弈论': 'game theory',
  '计算几何': 'computational geometry',
  '凸包': 'convex hull',
  '时间复杂度': 'time complexity',
  '空间复杂度': 'space complexity',
  '输入样例': 'sample input',
  '输出样例': 'sample output',
  '样例输入': 'sample input',
  '样例输出': 'sample output',
  '数据范围': 'constraints',
  '题目描述': 'problem description',
  '输入格式': 'input format',
  '输出格式': 'output format',
  '提示': 'hint',
  '题目背景': 'background',
  '多组测试数据': 'multiple test cases',
  '单组测试数据': 'single test case',
  '正整数': 'positive integer',
  '非负整数': 'non-negative integer',
  '整数': 'integer',
  '实数': 'real number',
  '矩阵': 'matrix',
  '邻接矩阵': 'adjacency matrix',
  '邻接表': 'adjacency list',
  '权值': 'weight',
  '边': 'edge',
  '顶点': 'vertex',
  '节点': 'node',
  '根节点': 'root node',
  '叶子节点': 'leaf node',
  '父节点': 'parent node',
  '子节点': 'child node',
  '祖先节点': 'ancestor node',
  '深度': 'depth',
  '高度': 'height',
}

/** 英文→中文 默认术语 */
const EN_TO_ZZ: Record<string, string> = Object.fromEntries(
  Object.entries(ZH_TO_EN).map(([zh, en]) => [en.toLowerCase(), zh])
)

// ===== 平台特殊规则 =====

const PLATFORM_RULES: Record<Platform, string[]> = {
  codeforces: [
    'Do NOT translate YES/NO, Alice/Bob, First/Second, or any answer literal.',
    'Codeforces problem IDs like "1234A" must remain unchanged.',
    'Time limits in milliseconds and memory limits in megabytes must remain unchanged.',
  ],
  atcoder: [
    'Do NOT translate YES/NO, Takahashi/Aoki, First/Second, or any answer literal.',
    'AtCoder problem IDs like "abc123_a" must remain unchanged.',
    'Contest names like "AtCoder Beginner Contest" should stay in English.',
  ],
  luogu: [
    'Do NOT translate YES/NO, Alice/Bob, or any answer literal.',
    'Luogu problem IDs like "P1001" must remain unchanged.',
    'Platform-specific tags like "洛谷" should be handled carefully.',
  ],
  usaco: [
    'Do NOT translate YES/NO or any answer literal.',
    'USACO file I/O names (e.g., "sort.in", "sort.out") must remain unchanged.',
    'Division names like "Bronze", "Silver", "Gold", "Platinum" should stay in English.',
    'Contest names like "USACO 2024 January" should stay in English.',
  ],
  other: [],
}

// ===== 公共接口 =====

/**
 * 获取术语表
 *
 * @param sourceLang 源语言
 * @param targetLang 目标语言
 * @param userGlossary 用户自定义术语（最高优先级）
 */
export function getGlossary(
  sourceLang: 'zh' | 'en',
  targetLang: 'zh' | 'en',
  userGlossary?: Record<string, string>
): Record<string, string> {
  // 选择对应方向的默认术语表
  const defaults = sourceLang === 'zh' ? ZH_TO_EN : EN_TO_ZZ

  // 合并：用户 > 默认
  return { ...defaults, ...userGlossary }
}

/**
 * 获取平台特殊规则（作为 prompt 的一部分）
 */
export function getPlatformRules(platform?: Platform): string[] {
  if (!platform || platform === 'other') return []
  return PLATFORM_RULES[platform] || []
}

/**
 * 将术语表格式化为 prompt 友好的字符串
 */
export function formatGlossaryForPrompt(glossary: Record<string, string>): string {
  const entries = Object.entries(glossary)
  if (entries.length === 0) return ''

  const lines = entries.map(([src, tgt]) => `- "${src}" → "${tgt}"`)
  return '术语表 (Glossary):\n' + lines.join('\n')
}
