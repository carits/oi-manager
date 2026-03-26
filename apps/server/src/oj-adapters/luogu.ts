/**
 * 洛谷适配器
 * @description 从洛谷平台拉取题目信息
 *
 * 限流配置：
 * - REQS_PER_SEC: 2.0（每秒最多 2 次请求）
 * - JITTER_SEC: 0.10-0.35（每次请求额外随机抖动）
 * - MAX_RETRIES: 3（最大重试次数）
 */

import { OjAdapter, OjProblem, OjFetchError, OjErrorCode, OjStatement } from './types'
import * as cheerio from 'cheerio'

/**
 * 洛谷 API 返回的题目数据结构
 */
interface LuoguProblemData {
  pid: string
  title: string
  content?: {
    background?: string
    description?: string
    formatI?: string  // 输入格式
    formatO?: string  // 输出格式
    hint?: string
  }
  // 英文题面（可能存在）
  contentEn?: {
    background?: string
    description?: string
    formatI?: string
    formatO?: string
    hint?: string
  }
  samples?: Array<{ input: string; output: string } | string[]>
  limits?: {
    time?: number[]
    memory?: number[]
  }
  difficulty?: number
  attachments?: Array<{ filename: string; downloadLink: string }>
}

/**
 * 洛谷页面中的 lentille-context 数据结构
 */
interface LentilleContext {
  data?: {
    problem?: LuoguProblemData
  }
}

export class LuoguAdapter implements OjAdapter {
  name = '洛谷'
  platform: OjPlatform = 'luogu'

  // 限流配置
  private static REQS_PER_SEC = 2.0
  private static JITTER_SEC: [number, number] = [0.10, 0.35]
  private static MAX_RETRIES = 3
  private static lastRequestTime = 0

  rateLimitConfig = {
    requestsPerSecond: LuoguAdapter.REQS_PER_SEC,
    jitterRange: LuoguAdapter.JITTER_SEC,
    maxRetries: LuoguAdapter.MAX_RETRIES,
  }

  async fetch(problemId: string): Promise<OjProblem> {
    // 验证题号格式
    if (!this.isValidProblemId(problemId)) {
      throw new OjFetchError(
        OjErrorCode.INVALID_PROBLEM_ID,
        `无效的洛谷题号: ${problemId}`
      )
    }

    let lastError: Error | null = null

    for (let attempt = 1; attempt <= LuoguAdapter.MAX_RETRIES; attempt++) {
      try {
        // 1. 限流控制
        await this.rateLimit()

        // 2. 请求洛谷页面
        const html = await this.fetchPage(problemId)

        // 3. 解析 lentille-context JSON
        const data = this.parseProblemData(html, problemId)

        // 4. 构建 Markdown 并返回
        return this.buildOjProblem(data, problemId)
      } catch (error) {
        lastError = error as Error

        // 网络错误：重试
        if (this.isNetworkError(error) && attempt < LuoguAdapter.MAX_RETRIES) {
          await this.sleep(1000 * attempt) // 指数退避
          continue
        }

        // 4xx 错误：不重试
        if (this.isClientError(error)) {
          if (this.isNotFoundError(error)) {
            throw new OjFetchError(
              OjErrorCode.PROBLEM_NOT_FOUND,
              `题目不存在: ${problemId}`,
              error
            )
          }
          throw new OjFetchError(
            OjErrorCode.CLIENT_ERROR,
            `请求失败: ${(error as any).message}`,
            error
          )
        }

        // 5xx 错误：重试后仍失败
        if (this.isServerError(error) && attempt === LuoguAdapter.MAX_RETRIES) {
          throw new OjFetchError(
            OjErrorCode.SERVER_ERROR,
            `洛谷服务器错误，请稍后重试`,
            error
          )
        }

        // 解析错误
        if (error instanceof OjFetchError) {
          throw error
        }
      }
    }

    // 所有重试都失败
    throw new OjFetchError(
      OjErrorCode.NETWORK_ERROR,
      `网络请求失败: ${lastError?.message}`,
      lastError || undefined
    )
  }

  /**
   * 验证题号格式是否正确
   * @description 洛谷题号格式：P开头+数字、B开头+数字、U开头+数字、AT开头+数字
   */
  isValidProblemId(problemId: string): boolean {
    return /^P\d+$/.test(problemId) ||
           /^B\d+$/.test(problemId) ||
           /^U\d+$/.test(problemId) ||
           /^AT\d+$/.test(problemId)
  }

  /**
   * 获取题目在洛谷的 URL
   */
  getProblemUrl(problemId: string): string {
    return `https://www.luogu.com.cn/problem/${problemId}`
  }

  /**
   * 限流控制
   * @description 确保请求间隔满足限流要求
   */
  private async rateLimit(): Promise<void> {
    const now = Date.now()
    const minInterval = 1000 / LuoguAdapter.REQS_PER_SEC // 500ms
    const jitter = this.getRandomJitter()

    const elapsed = now - LuoguAdapter.lastRequestTime
    const waitTime = minInterval + jitter - elapsed

    if (waitTime > 0) {
      await this.sleep(waitTime)
    }

    LuoguAdapter.lastRequestTime = Date.now()
  }

  private getRandomJitter(): number {
    const [min, max] = LuoguAdapter.JITTER_SEC
    return (min + Math.random() * (max - min)) * 1000
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 请求洛谷题目页面
   * @description 洛谷有反爬虫保护，需要处理 Cookie 和重定向
   */
  private async fetchPage(problemId: string): Promise<string> {
    const url = this.getProblemUrl(problemId)
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.luogu.com.cn/',
    }

    // 第一次请求：获取 Cookie
    const firstResponse = await fetch(url, {
      headers,
      redirect: 'manual',
    })

    // 提取 Cookie
    const cookies: string[] = []
    firstResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        const cookie = value.split(';')[0]
        cookies.push(cookie)
      }
    })

    // 如果有重定向，带着 Cookie 再次请求
    if (firstResponse.status === 302 || firstResponse.status === 301) {
      const cookieHeader = cookies.join('; ')
      const response = await fetch(url, {
        headers: {
          ...headers,
          'Cookie': cookieHeader,
        },
        redirect: 'follow',
      })

      if (!response.ok) {
        const error: any = new Error(`HTTP ${response.status}`)
        error.response = response
        throw error
      }

      return response.text()
    }

    // 没有重定向，直接返回
    if (!firstResponse.ok) {
      const error: any = new Error(`HTTP ${firstResponse.status}`)
      error.response = firstResponse
      throw error
    }

    return firstResponse.text()
  }

  /**
   * 解析页面中的题目数据
   */
  private parseProblemData(html: string, problemId: string): LuoguProblemData {
    const $ = cheerio.load(html)

    // 查找 lentille-context 脚本标签
    const script = $('script#lentille-context')
    if (!script.length) {
      throw new OjFetchError(
        OjErrorCode.PARSE_ERROR,
        `无法解析题目数据: 页面结构已变更`,
        new Error('lentille-context not found')
      )
    }

    try {
      const jsonStr = script.html()
      if (!jsonStr) {
        throw new Error('Empty script content')
      }

      const context: LentilleContext = JSON.parse(jsonStr)
      const problem = context.data?.problem

      if (!problem) {
        throw new OjFetchError(
          OjErrorCode.PROBLEM_NOT_FOUND,
          `题目不存在: ${problemId}`
        )
      }

      // 调试：打印题目数据结构
      console.log('[LuoguAdapter] Problem data structure:', {
        pid: problem.pid,
        title: problem.title,
        hasContent: !!problem.content,
        contentKeys: problem.content ? Object.keys(problem.content) : [],
        background: problem.content?.background ? problem.content.background.substring(0, 100) + '...' : 'N/A',
        description: problem.content?.description ? problem.content.description.substring(0, 100) + '...' : 'N/A',
        hasSamples: !!problem.samples,
        samplesCount: problem.samples?.length,
        hasLimits: !!problem.limits,
        hasAttachments: !!problem.attachments,
      })

      return problem
    } catch (error) {
      if (error instanceof OjFetchError) {
        throw error
      }
      throw new OjFetchError(
        OjErrorCode.PARSE_ERROR,
        `解析题目数据失败: ${(error as Error).message}`,
        error as Error
      )
    }
  }

  /**
   * 构建 OjProblem 对象
   */
  private buildOjProblem(data: LuoguProblemData, problemId: string): OjProblem {
    // 构建中文题面
    const markdownZh = this.buildMarkdown(data, data.content)

    // 构建英文题面（如果存在）
    const markdownEn = data.contentEn ? this.buildMarkdown(data, data.contentEn) : null

    // 获取时间和内存限制（取第一个值）
    // Luogu timeLimit 单位是毫秒(ms)，保持不变
    const timeLimit = data.limits?.time?.[0]
    // Luogu memoryLimit 单位是 KB，转换为 MB (除以 1024)
    const memoryLimitKB = data.limits?.memory?.[0]
    const memoryLimit = memoryLimitKB ? Math.round(memoryLimitKB / 1024) : undefined

    // 难度映射
    const difficulty = this.mapDifficulty(data.difficulty)

    // 处理附件
    const attachments = data.attachments?.map(att => ({
      filename: att.filename,
      downloadLink: att.downloadLink.startsWith('http')
        ? att.downloadLink
        : `https://www.luogu.com.cn${att.downloadLink}`
    }))

    // 构建多语言 statements 数组
    const statements: import('./types').OjStatement[] = []

    // 中文题面（默认可见）
    if (markdownZh.trim()) {
      statements.push({
        type: 'statement',
        format: 'markdown',
        language: 'zh',
        content: markdownZh,
        isVisible: true
      })
    }

    // 英文题面（默认隐藏）
    if (markdownEn?.trim()) {
      statements.push({
        type: 'statement',
        format: 'markdown',
        language: 'en',
        content: markdownEn,
        isVisible: false
      })
    }

    return {
      title: data.title || `${problemId} 题目`,
      description: markdownZh, // 保持向后兼容，默认返回中文
      timeLimit: timeLimit,
      memoryLimit: memoryLimit,
      difficulty,
      source: {
        platform: 'luogu',
        problemId,
        url: this.getProblemUrl(problemId),
      },
      attachments,
      statements, // 新增多语言题面数组
    }
  }

  /**
   * 构建 Markdown 格式的题目描述
   * @param data - 题目数据（用于获取样例和附件）
   * @param content - 题面内容（可以是中文或英文）
   */
  private buildMarkdown(data: LuoguProblemData, content?: LuoguProblemData['content']): string {
    const parts: string[] = []
    const contentData = content || data.content || {}

    // 题目背景
    if (contentData.background?.trim()) {
      parts.push('## 题目背景')
      parts.push('')
      parts.push(contentData.background.trim())
      parts.push('')
    }

    // 题目描述
    if (contentData.description?.trim()) {
      parts.push('## 题目描述')
      parts.push('')
      parts.push(contentData.description.trim())
      parts.push('')
    }

    // 输入格式
    if (contentData.formatI?.trim()) {
      parts.push('## 输入格式')
      parts.push('')
      parts.push(contentData.formatI.trim())
      parts.push('')
    }

    // 输出格式
    if (contentData.formatO?.trim()) {
      parts.push('## 输出格式')
      parts.push('')
      parts.push(contentData.formatO.trim())
      parts.push('')
    }

    // 样例（只在中文版本显示，英文版本也显示相同的样例）
    if (data.samples && data.samples.length > 0) {
      parts.push('## 样例')
      parts.push('')
      data.samples.forEach((sample, index) => {
        // 支持数组和对象两种格式
        let sampleInput = ''
        let sampleOutput = ''
        if (Array.isArray(sample)) {
          sampleInput = sample[0] || ''
          sampleOutput = sample[1] || ''
        } else {
          sampleInput = sample.input || ''
          sampleOutput = sample.output || ''
        }

        parts.push(`### 样例 ${index + 1}`)
        parts.push('')
        parts.push('**输入**')
        parts.push('')
        parts.push('```')
        parts.push(sampleInput)
        parts.push('```')
        parts.push('')
        parts.push('**输出**')
        parts.push('')
        parts.push('```')
        parts.push(sampleOutput)
        parts.push('```')
        parts.push('')
      })
    }

    // 提示
    if (contentData.hint?.trim()) {
      parts.push('## 提示')
      parts.push('')
      parts.push(contentData.hint.trim())
      parts.push('')
    }

    // 附件（只在中文版本显示）
    if (!content && data.attachments && data.attachments.length > 0) {
      parts.push('## 附件')
      parts.push('')
      data.attachments.forEach((attachment) => {
        const url = attachment.downloadLink.startsWith('http')
          ? attachment.downloadLink
          : `https://www.luogu.com.cn${attachment.downloadLink}`
        parts.push(`- [${attachment.filename}](${url})`)
      })
      parts.push('')
    }

    return parts.join('\n')
  }

  /**
   * 映射难度等级
   */
  private mapDifficulty(difficulty?: number): string {
    if (difficulty === undefined || difficulty === null) {
      return '未评级'
    }

    // 洛谷难度 1-8 级映射
    const difficultyMap: Record<number, string> = {
      1: '入门',
      2: '普及-',
      3: '普及/提高-',
      4: '普及+/提高',
      5: '提高+/省选-',
      6: '省选/NOI-',
      7: 'NOI/NOI+/CTSC',
      8: 'CTSC',
    }

    return difficultyMap[difficulty] || `难度 ${difficulty}`
  }

  // 错误判断辅助方法
  private isNetworkError(error: any): boolean {
    return error.code === 'ECONNREFUSED' ||
           error.code === 'ETIMEDOUT' ||
           error.code === 'ENOTFOUND' ||
           error.code === 'UND_ERR_CONNECT_TIMEOUT' ||
           error.name === 'TimeoutError'
  }

  private isClientError(error: any): boolean {
    const status = error.response?.status
    return status >= 400 && status < 500
  }

  private isServerError(error: any): boolean {
    const status = error.response?.status
    return status >= 500
  }

  private isNotFoundError(error: any): boolean {
    return error.response?.status === 404
  }
}

// 类型导出
type OjPlatform = import('./types').OjPlatform
