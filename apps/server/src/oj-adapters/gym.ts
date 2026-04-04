/**
 * Codeforces Gym 适配器
 * @description 从 Codeforces Gym 平台拉取题目信息（HTML 抓取）
 *
 * 题号格式: {contestId}{letter}，如 106449A
 * 主站 URL: https://codeforces.com/gym/{contestId}/problem/{letter}
 * 镜像 URL: https://mirror.codeforces.com/gym/{contestId}/problem/{letter}
 *
 * 与 Codeforces problemset 的区别：
 * 1. URL 路径使用 /gym/ 而非 /problemset/problem/
 * 2. 无法用洛谷兜底（洛谷没有 Gym 题目）
 * 3. 部分 Gym 题目只有 PDF 版本，遇到时返回拉取失败错误
 *
 * 继承 CodeforcesAdapter，复用 HTML 解析逻辑
 */

import { OjProblem, OjFetchError, OjErrorCode } from './types'
import { CodeforcesAdapter } from './codeforces'
import * as cheerio from 'cheerio'

export class GymAdapter extends CodeforcesAdapter {
  name = 'CF Gym'
  platform: import('./types').OjPlatform = 'gym'

  /**
   * 验证题号格式
   * Gym 题号格式与 CF problemset 相同: {contestId}{letter}
   */
  isValidProblemId(problemId: string): boolean {
    return /^\d+[A-Za-z]\d*$/.test(problemId)
  }

  /**
   * 获取题目在 Codeforces Gym 的 URL
   */
  getProblemUrl(problemId: string): string {
    const { contestId, index } = this.parseProblemId(problemId)
    return `https://codeforces.com/gym/${contestId}/problem/${index}`
  }

  /**
   * Override: 镜像 URL 使用 /gym/ 路径
   */
  protected buildMirrorUrl(contestId: string, index: string): string {
    return `https://mirror.codeforces.com/gym/${contestId}/problem/${index}`
  }

  /**
   * Override: Gym 拉取逻辑
   * - 无洛谷兜底
   * - PDF 检测：无 problem-statement 时检查 PDF 链接
   */
  async fetch(problemId: string): Promise<OjProblem> {
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(
        OjErrorCode.INVALID_PROBLEM_ID,
        `无效的 CF Gym 题号: ${problemId}。格式应为 106449A 等。`
      )
    }

    let lastError: Error | null = null

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.rateLimit()

        const { contestId, index } = this.parseProblemId(problemId)
        const url = this.buildMirrorUrl(contestId, index)
        const html = await this.fetchPage(url)

        // 检测 Cloudflare 拦截页
        if (this.isCloudflareBlock(html)) {
          throw new Error('CLOUDFLARE_BLOCKED: Codeforces Gym 返回了 Cloudflare 拦截页')
        }

        // PDF 检测：无 problem-statement 时检查 PDF
        const $ = cheerio.load(html)
        if ($('div.problem-statement').length === 0) {
          const hasPdf = $('a[href$=".pdf"]').length > 0 ||
                        $('iframe[src$=".pdf"]').length > 0 ||
                        $('a[href*=".pdf"]').length > 0
          if (hasPdf) {
            throw new OjFetchError(
              OjErrorCode.PARSE_ERROR,
              'CF Gym 题目只有 PDF 版本，暂不支持拉取'
            )
          }
          throw new OjFetchError(
            OjErrorCode.PARSE_ERROR,
            '未找到题目内容，页面结构可能已变更'
          )
        }

        // 复用 parsePage 但覆盖 source
        const result = this.parsePage(html, problemId, contestId, index)
        result.source = {
          platform: 'gym',
          problemId,
          url: `https://codeforces.com/gym/${contestId}/problem/${index}`,
        }

        return result
      } catch (error) {
        lastError = error as Error

        if (this.isNetworkError(error) && attempt < 3) {
          await this.sleep(1000 * attempt)
          continue
        }

        if (error instanceof OjFetchError) throw error

        if (this.isClientError(error)) break
        if (this.isCloudflareError(error)) break
      }
    }

    // 无洛谷兜底，直接抛错
    throw lastError instanceof OjFetchError ? lastError :
      new OjFetchError(
        OjErrorCode.NETWORK_ERROR,
        `CF Gym 拉取失败: ${lastError?.message}`,
        lastError || undefined
      )
  }
}
