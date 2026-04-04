/**
 * deepseek.ts — DeepSeek API 封装
 *
 * 使用 OpenAI SDK 兼容方式接入。
 * 支持重试、超时、JSON 模式。
 */

import OpenAI from 'openai'
import type { DeepSeekCallOptions, DeepSeekCallResult } from './types'

// ===== 客户端初始化 =====

let _client: OpenAI | null = null

function getClient(): OpenAI {
  if (!_client) {
    const apiKey = process.env.DEEPSEEK_API_KEY
    if (!apiKey) {
      throw new Error('DEEPSEEK_API_KEY 环境变量未配置')
    }

    _client = new OpenAI({
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
      apiKey,
    })
  }
  return _client
}

/** 重置客户端（测试用） */
export function resetClient(): void {
  _client = null
}

// ===== API 调用 =====

/**
 * 调用 DeepSeek Chat Completions API
 *
 * @returns 模型响应内容 + token 用量
 * @throws 超时、网络错误、API 错误
 */
export async function callDeepSeek(options: DeepSeekCallOptions): Promise<DeepSeekCallResult> {
  const {
    messages,
    temperature = 0.1,
    maxTokens = 4096,
    jsonMode = false,
    timeout = 60000,
    maxRetries = 3,
  } = options

  const client = getClient()
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 使用 AbortController 实现超时
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await client.chat.completions.create(
        {
          model,
          messages,
          temperature,
          max_tokens: maxTokens,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        },
        {
          signal: controller.signal,
        }
      )

      clearTimeout(timeoutId)

      const content = response.choices[0]?.message?.content || ''
      const usage = response.usage

      // 空内容检查（DeepSeek JSON 模式偶发）
      if (!content || content.trim().length === 0) {
        throw new Error(`DeepSeek returned empty content (attempt ${attempt}/${maxRetries})`)
      }

      return {
        content,
        usage: usage
          ? {
              promptTokens: usage.prompt_tokens,
              completionTokens: usage.completion_tokens,
              totalTokens: usage.total_tokens,
            }
          : undefined,
      }
    } catch (error: unknown) {
      lastError = error as Error

      // AbortError = 超时
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new Error(`DeepSeek API timeout after ${timeout}ms (attempt ${attempt}/${maxRetries})`)
      }

      // 429 Rate Limit — 等待后重试
      if (error instanceof Error && error.message?.includes('429')) {
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 10000)
        await sleep(waitMs)
        continue
      }

      // 5xx Server Error — 重试
      if (error instanceof Error && /5\d{2}/.test(error.message)) {
        const waitMs = 1000 * attempt
        await sleep(waitMs)
        continue
      }

      // 4xx Client Error — 不重试（除了 429）
      if (error instanceof Error && /4\d{2}/.test(error.message)) {
        break
      }

      // 其他错误（网络等）— 重试
      if (attempt < maxRetries) {
        await sleep(500 * attempt)
      }
    }
  }

  throw new Error(`DeepSeek API failed after ${maxRetries} retries: ${lastError?.message}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
