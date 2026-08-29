import crypto from 'crypto'
import type { JwtPayload } from '@oi-manager/shared'
import { prisma } from '../../../prisma'
import { canModifyProblem } from '../problem.access'
import { releaseAiTokens, reserveAiTokens, settleAiTokens } from '../../ai/ai-token.service'

const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || ''

export class ProblemAiRouteError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new ProblemAiRouteError(statusCode, code, message)
}

function isGlobalAdmin(user: JwtPayload) {
  return user.role === 'super_admin' || user.role === 'platform_admin'
}

async function requireManageableProblem(user: JwtPayload, problemId: string) {
  const problem = await prisma.problem.findUnique({ where: { id: problemId } })
  if (!problem || !canModifyProblem(user, problem)) {
    fail(404, 'PROBLEM_NOT_FOUND', '题目不存在')
  }
  return problem
}

function requireAiProvider() {
  if (!DEEPSEEK_API_KEY) fail(400, 'AI_PROVIDER_NOT_CONFIGURED', '未配置 DEEPSEEK_API_KEY')
}

async function runMeteredAi<T extends { metadata: { model: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number }; cached?: boolean } }>(input: {
  user: JwtPayload; problemId: string; statementId?: string; action: string; estimatedTokens: number; execute: () => Promise<T>
}) {
  const requestId = crypto.randomUUID()
  const reserved = Math.max(4096, Math.min(100_000, Math.ceil(input.estimatedTokens)))
  await prisma.aiGenerationRequest.create({ data: {
    id: requestId, userId: input.user.userId, problemId: input.problemId, statementId: input.statementId,
    action: input.action, model: process.env.DEEPSEEK_MODEL || 'deepseek-chat', status: 'pending_reservation',
    reservedTokens: reserved, promptHash: crypto.createHash('sha256').update(`${input.action}:${input.problemId}:${input.statementId || ''}`).digest('hex'),
  } })
  try { await reserveAiTokens({ requestId, userId: input.user.userId, amount: reserved, problemId: input.problemId, action: input.action }) }
  catch (error) {
    await prisma.aiGenerationRequest.update({ where: { id: requestId }, data: { status: 'failed', errorMessage: error instanceof Error ? error.message : 'Token 预占失败', finishedAt: new Date() } })
    throw error
  }
  await prisma.aiGenerationRequest.update({ where: { id: requestId }, data: { status: 'running', startedAt: new Date() } })
  let finalized = false
  try {
    const result = await input.execute()
    const actual = result.metadata.cached ? 0 : result.metadata.usage?.totalTokens ?? reserved
    await settleAiTokens({ requestId, userId: input.user.userId, reserved, actual })
    finalized = true
    await prisma.aiGenerationRequest.update({ where: { id: requestId }, data: {
      status: 'completed', promptTokens: result.metadata.usage?.promptTokens,
      completionTokens: result.metadata.usage?.completionTokens, totalTokens: result.metadata.usage?.totalTokens,
      finishedAt: new Date(), response: { cached: Boolean(result.metadata.cached) },
    } })
    return { result, requestId, actual }
  } catch (error) {
    if (!finalized) {
      await releaseAiTokens({ requestId, userId: input.user.userId, reserved, reason: 'DeepSeek 请求未返回可计费用量' }).catch(() => undefined)
    }
    await prisma.aiGenerationRequest.update({ where: { id: requestId }, data: { status: 'failed', errorMessage: error instanceof Error ? error.message : 'AI 请求失败', finishedAt: new Date() } }).catch(() => undefined)
    throw error
  }
}

async function loadTranslationSource(problemId: string, statementId?: string) {
  if (statementId) {
    const statement = await prisma.problemStatement.findFirst({
      where: { id: statementId, problemId },
    })
    if (!statement) fail(404, 'STATEMENT_NOT_FOUND', '题面记录不存在')
    return statement
  }
  const statement = await prisma.problemStatement.findFirst({
    where: { problemId, type: 'statement', format: 'markdown' },
    orderBy: { createdAt: 'asc' },
  })
  if (!statement?.content) {
    fail(400, 'MARKDOWN_STATEMENT_REQUIRED', '没有可翻译的 Markdown 题面')
  }
  return statement
}

async function assertTranslationAvailable(problemId: string, targetLang: string) {
  const existing = await prisma.problemStatement.findFirst({
    where: { problemId, type: 'statement', format: 'markdown', language: targetLang },
    select: { id: true },
  })
  if (existing) {
    fail(
      409,
      'TRANSLATION_ALREADY_EXISTS',
      `已存在${targetLang === 'zh' ? '中文' : '英文'}翻译版本，不能重复翻译`,
    )
  }
}

export async function translateProblemStatement(input: {
  user: JwtPayload
  problemId: string
  targetLang?: unknown
  statementId?: unknown
}) {
  await requireManageableProblem(input.user, input.problemId)
  requireAiProvider()
  const targetLang = typeof input.targetLang === 'string' && input.targetLang.trim()
    ? input.targetLang.trim()
    : 'en'
  if (!['zh', 'en'].includes(targetLang)) {
    fail(400, 'TARGET_LANGUAGE_INVALID', '目标语言仅支持 zh 或 en')
  }
  const statementId = typeof input.statementId === 'string' && input.statementId
    ? input.statementId
    : undefined
  const admin = isGlobalAdmin(input.user)
  if (!admin) await assertTranslationAvailable(input.problemId, targetLang)
  const source = await loadTranslationSource(input.problemId, statementId)
  const content = source.content || ''
  if (!content.trim()) fail(400, 'STATEMENT_CONTENT_EMPTY', '题面内容为空')
  const sourceLang = source.language || 'zh'

  const { translateDocument } = await import('../../../lib/ai-translate')
  const metered = await runMeteredAi({ user: input.user, problemId: input.problemId, statementId: source.id, action: 'translate', estimatedTokens: Math.ceil(content.length / 2) + 8192, execute: () => translateDocument({ text: content, sourceLang: sourceLang as any, targetLang: targetLang as any, temperature: 0.1 }) })
  const result = metered.result

  const newStatement = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-translate:${input.problemId}:${targetLang}`}, 0)) IS NULL AS locked`
    if (!admin) {
      const existing = await tx.problemStatement.findFirst({
        where: {
          problemId: input.problemId,
          type: 'statement',
          format: 'markdown',
          language: targetLang,
        },
        select: { id: true },
      })
      if (existing) {
        fail(
          409,
          'TRANSLATION_ALREADY_EXISTS',
          `已存在${targetLang === 'zh' ? '中文' : '英文'}翻译版本，不能重复翻译`,
        )
      }
    }
    const created = await tx.problemStatement.create({
      data: {
        id: crypto.randomUUID(),
        problemId: input.problemId,
        type: 'statement',
        format: 'markdown',
        language: targetLang,
        content: result.translated,
        isVisible: source.isVisible,
      },
    })
    await tx.aiUsageLog.create({
      data: {
        id: crypto.randomUUID(),
        userId: input.user.userId,
        problemId: input.problemId,
        action: 'translate',
        sourceLang,
        targetLang,
        model: result.metadata.model,
        tokensUsed: metered.actual,
        promptTokens: result.metadata.usage?.promptTokens,
        completionTokens: result.metadata.usage?.completionTokens,
        totalTokens: result.metadata.usage?.totalTokens,
        requestId: metered.requestId,
        status: 'success',
        statementId: created.id,
      },
    })
    return created
  })
  return {
    statementId: newStatement.id,
    content: result.translated,
    sourceLang,
    targetLang,
    diagnostics: result.diagnostics,
  }
}

async function loadFormattingSource(problemId: string, statementId?: string) {
  const statement = statementId
    ? await prisma.problemStatement.findFirst({
        where: { id: statementId, problemId, format: 'markdown' },
      })
    : await prisma.problemStatement.findFirst({
        where: { problemId, type: 'statement', format: 'markdown' },
        orderBy: { createdAt: 'asc' },
      })
  if (!statement) {
    if (statementId) fail(404, 'STATEMENT_NOT_FOUND', '题面记录不存在')
    fail(400, 'MARKDOWN_STATEMENT_REQUIRED', '没有可格式化的 Markdown 题面')
  }
  if (!statement.content?.trim()) fail(400, 'STATEMENT_CONTENT_EMPTY', '题面内容为空')
  return statement
}

async function assertFormatAvailable(problemId: string, statementId: string) {
  const log = await prisma.aiUsageLog.findFirst({
    where: {
      problemId,
      action: 'format',
      status: 'success',
      statementId,
    },
    select: { id: true },
  })
  if (log) fail(409, 'STATEMENT_ALREADY_FORMATTED', '该题面已格式化过，不能重复格式化')
}

export async function formatProblemStatement(input: {
  user: JwtPayload
  problemId: string
  statementId?: unknown
}) {
  await requireManageableProblem(input.user, input.problemId)
  requireAiProvider()
  const requestedStatementId = typeof input.statementId === 'string' && input.statementId
    ? input.statementId
    : undefined
  const source = await loadFormattingSource(input.problemId, requestedStatementId)
  const admin = isGlobalAdmin(input.user)
  if (!admin) await assertFormatAvailable(input.problemId, source.id)

  const { formatDocument } = await import('../../../lib/ai-translate')
  const metered = await runMeteredAi({ user: input.user, problemId: input.problemId, statementId: source.id, action: 'format', estimatedTokens: Math.ceil(source.content!.length / 2) + 8192, execute: () => formatDocument(source.content!) })
  const result = metered.result
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-format:${input.problemId}:${source.id}`}, 0)) IS NULL AS locked`
    if (!admin) {
      const log = await tx.aiUsageLog.findFirst({
        where: {
          problemId: input.problemId,
          action: 'format',
          status: 'success',
          statementId: source.id,
        },
        select: { id: true },
      })
      if (log) {
        fail(409, 'STATEMENT_ALREADY_FORMATTED', '该题面已格式化过，不能重复格式化')
      }
    }
    await tx.problemStatement.update({
      where: { id: source.id },
      data: { content: result.translated },
    })
    await tx.aiUsageLog.create({
      data: {
        id: crypto.randomUUID(),
        userId: input.user.userId,
        problemId: input.problemId,
        action: 'format',
        model: result.metadata.model,
        tokensUsed: metered.actual,
        promptTokens: result.metadata.usage?.promptTokens,
        completionTokens: result.metadata.usage?.completionTokens,
        totalTokens: result.metadata.usage?.totalTokens,
        requestId: metered.requestId,
        status: 'success',
        statementId: source.id,
      },
    })
  })
  return { content: result.translated, diagnostics: result.diagnostics }
}

export async function getProblemAiUsage(user: JwtPayload, problemId: string) {
  await requireManageableProblem(user, problemId)
  const [statements, formatLogs] = await Promise.all([
    prisma.problemStatement.findMany({
      where: { problemId, type: 'statement', format: 'markdown' },
      select: { id: true, language: true, content: true, createdAt: true },
    }),
    prisma.aiUsageLog.findMany({
      where: { problemId, action: 'format', status: 'success' },
      select: { statementId: true },
    }),
  ])
  return {
    isAdmin: isGlobalAdmin(user),
    translations: {
      zh: statements.some(statement => statement.language === 'zh'),
      en: statements.some(statement => statement.language === 'en'),
    },
    formattedStatementIds: Array.from(new Set(
      formatLogs.map(log => log.statementId).filter(Boolean) as string[],
    )),
    markdownStatements: statements.map(statement => ({
      id: statement.id, language: statement.language, createdAt: statement.createdAt,
      maxReservedTokens: Number(process.env.AI_VALIDATOR_MAX_OUTPUT_TOKENS || 8192)
        + Math.max(Number(process.env.AI_VALIDATOR_PROMPT_RESERVE || 6000), Math.ceil((statement.content?.length || 0) / 2)),
    })),
  }
}
