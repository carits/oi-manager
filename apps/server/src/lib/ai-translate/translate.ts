/**
 * translate.ts — 统一服务入口
 *
 * 完整流水线：保护 → 分块 → 翻译 → 还原 → 校验 → 缓存 → 降级
 * P0 可观测性增强：添加调用计时和 metrics
 */

import type { TranslateOptions, TranslationResult, Language } from './types'
import { protectFull, resetCounter } from './protect'
import { restoreAndVerify } from './restore'
import { splitText } from './splitter'
import { buildSystemPrompt, buildUserPrompt, buildFormatPrompt } from './prompt'
import { getGlossary } from './glossary'
import { callDeepSeek } from './deepseek'
import { validate } from './validate'
import { TranslationCache, getTranslationCache } from './cache'
import logger from '../logger'
import { metrics } from '../metrics'

/**
 * 检测文本语言（中文 vs 英文）
 */
function detectLanguage(text: string): Language {
  if (!text || text.trim().length === 0) return 'zh'
  const clean = text.replace(/[\s\r\n\d!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g, '')
  if (clean.length === 0) return 'zh'
  const cjk = clean.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)
  const ratio = cjk ? cjk.length / clean.length : 0
  return ratio > 0.05 ? 'zh' : 'en'
}

/**
 * 翻译文档
 *
 * @param input 翻译选项
 * @returns 翻译结果 + 诊断信息
 */
export async function translateDocument(input: TranslateOptions): Promise<TranslationResult> {
  const startTime = Date.now()
  const {
    text,
    targetLang,
    platform,
    format = 'markdown',
    outputMode = 'text',
    temperature = 0.1,
    maxRetries = 3,
    timeout = 60000,
    maxChunkSize = 3000,
  } = input

  const sourceLang = input.sourceLang || detectLanguage(text)
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
  const cache = getTranslationCache()

  // 1. 检查缓存
  const glossary = getGlossary(sourceLang, targetLang, input.glossary)
  const cacheKey = TranslationCache.makeKey({
    text,
    sourceLang,
    targetLang,
    platform,
    glossaryHash: JSON.stringify(glossary),
    model,
  })
  const cached = cache.get(cacheKey)
  if (cached) {
    const duration = Date.now() - startTime
    metrics.recordExternalCall('ai_translate:cached', duration, true)
    logger.info('ai_translate_cache_hit', {
      action: 'ai_translate',
      metadata: {
        sourceLang,
        targetLang,
        platform,
        durationMs: duration,
        cached: true
      }
    })
    return {
      translated: cached.translated,
      sourceFormat: format,
      metadata: { ...cached.metadata, cached: true, usage: undefined },
      diagnostics: {
        warnings: ['Result served from cache'],
        structureValid: true,
        placeholderCountBefore: 0,
        placeholderCountAfter: 0,
      },
    }
  }

  logger.info('ai_translate_start', {
    action: 'ai_translate',
    metadata: {
      sourceLang,
      targetLang,
      platform,
      textLength: text.length
    }
  })

  // 2. 保护危险片段
  resetCounter()
  const { protectedText, placeholders, stats } = protectFull(text)
  const placeholderCount = placeholders.length

  // 3. 分块
  const chunks = splitText(protectedText, { maxChunkSize })

  // 4. 逐块翻译
  const systemPrompt = buildSystemPrompt(platform)
  const translatedChunks: string[] = []
  const warnings: string[] = []
  let totalUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]
    const userPrompt = buildUserPrompt(chunk, {
      sourceLang,
      targetLang,
      platform,
      glossary,
      outputMode,
    })

    let translatedChunk = ''
    let succeeded = false

    // 重试逻辑
    for (let retry = 0; retry <= maxRetries; retry++) {
      try {
        const result = await callDeepSeek({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature,
          maxTokens: 4096,
          jsonMode: outputMode === 'json',
          timeout,
          maxRetries: 1, // 单块级别不重试，由外层控制
        })

        if (result.usage) {
          totalUsage.promptTokens += result.usage.promptTokens
          totalUsage.completionTokens += result.usage.completionTokens
          totalUsage.totalTokens += result.usage.totalTokens
        }

        // JSON 模式解析
        if (outputMode === 'json') {
          try {
            const json = JSON.parse(result.content)
            translatedChunk = json.translated_text || ''
            if (json.warnings?.length) {
              warnings.push(...json.warnings)
            }
          } catch {
            // JSON 解析失败，尝试直接使用内容
            warnings.push(`Chunk ${i + 1}: JSON parse failed, using raw content`)
            translatedChunk = result.content
          }
        } else {
          translatedChunk = result.content
        }

        succeeded = true
        break
      } catch (error) {
        if (retry === maxRetries - 1) {
          warnings.push(`Chunk ${i + 1}: Failed after ${maxRetries} retries: ${(error as Error).message}`)
          // 降级：保留原文
          translatedChunk = chunk
        }
      }
    }

    if (!succeeded && !translatedChunk) {
      translatedChunk = chunk
    }

    translatedChunks.push(translatedChunk)
  }

  // 合并翻译结果
  const translatedProtected = translatedChunks.join('\n\n')

  // 5. 还原占位符
  const { text: restoredText, success: restoreSuccess, residualIds } = restoreAndVerify(
    translatedProtected,
    placeholders
  )

  if (!restoreSuccess) {
    warnings.push(`占位符还原不完整，残留: ${residualIds.join(', ')}`)
  }

  // 6. 结构校验
  const validation = validate(text, restoredText, placeholders)

  if (!validation.valid) {
    warnings.push(...validation.errors)
  }

  const result: TranslationResult = {
    translated: restoredText,
    sourceFormat: format,
    metadata: {
      chunksProcessed: chunks.length,
      cached: false,
      placeholdersProtected: placeholderCount,
      model,
      usage: totalUsage,
    },
    diagnostics: {
      warnings,
      structureValid: validation.valid && restoreSuccess,
      placeholderCountBefore: placeholderCount,
      placeholderCountAfter: placeholderCount - residualIds.length,
    },
  }

  // 7. 写入缓存
  cache.set(cacheKey, restoredText, result.metadata)

  // 8. 记录指标
  const duration = Date.now() - startTime
  const success = validation.valid && restoreSuccess
  metrics.recordExternalCall('ai_translate:call', duration, success)
  logger.info('ai_translate_success', {
    action: 'ai_translate',
    metadata: {
      sourceLang,
      targetLang,
      platform,
      durationMs: duration,
      chunksProcessed: chunks.length,
      totalTokens: totalUsage.totalTokens,
      structureValid: success
    }
  })

  return result
}

/**
 * 格式化文档（不翻译，只修正 Markdown 格式）
 */
export async function formatDocument(
  text: string,
  options: {
    platform?: TranslateOptions['platform']
    temperature?: number
    maxRetries?: number
    timeout?: number
  } = {}
): Promise<TranslationResult> {
  const startTime = Date.now()
  const {
    platform,
    temperature = 1,
    maxRetries = 3,
    timeout = 60000,
  } = options

  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat'

  // 格式化也需要保护代码块等
  resetCounter()
  const { protectedText, placeholders } = protectFull(text)

  const { system, user } = buildFormatPrompt(protectedText, platform)

  const result = await callDeepSeek({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature,
    maxTokens: 8192,
    timeout,
    maxRetries,
  })

  // 还原
  const { text: restoredText, success: restoreSuccess, residualIds } = restoreAndVerify(
    result.content,
    placeholders
  )

  // 校验
  const validation = validate(text, restoredText, placeholders)

  // 记录指标
  const duration = Date.now() - startTime
  metrics.recordExternalCall('ai_translate:format', duration, validation.valid && restoreSuccess)
  logger.info('ai_format_done', {
    action: 'ai_translate',
    metadata: { durationMs: duration, platform, structureValid: validation.valid }
  })

  return {
    translated: restoredText,
    sourceFormat: 'markdown',
    metadata: {
      chunksProcessed: 1,
      cached: false,
      placeholdersProtected: placeholders.length,
      model,
      usage: result.usage,
    },
    diagnostics: {
      warnings: [
        ...(!restoreSuccess ? [`占位符还原不完整: ${residualIds.join(', ')}`] : []),
        ...validation.errors,
      ],
      structureValid: validation.valid && restoreSuccess,
      placeholderCountBefore: placeholders.length,
      placeholderCountAfter: placeholders.length - residualIds.length,
    },
  }
}
