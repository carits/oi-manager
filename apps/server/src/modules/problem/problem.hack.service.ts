import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import yaml from 'js-yaml'
import { prisma } from '../../prisma'

export const HACK_SOURCE_LIMIT = 256 * 1024
export const HACK_INPUT_LIMIT = 1024 * 1024

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
const problemLocks = new Map<string, Promise<unknown>>()

export function judgeConfigHash(config: string | null | undefined): string {
  return crypto.createHash('sha256').update(config || '').digest('hex')
}

export function parseJudgeConfig(config: string | null | undefined): Record<string, any> {
  if (!config?.trim()) return {}
  const parsed = yaml.load(config)
  return parsed && typeof parsed === 'object' ? parsed as Record<string, any> : {}
}

export function resolveJudgeMode(config: Record<string, any>): 'acm' | 'oi' {
  if (config.mode === 'oi') return 'oi'
  if (config.mode === 'acm') return 'acm'
  return Array.isArray(config.subtasks) && config.subtasks.length > 0 ? 'oi' : 'acm'
}

export function isHackableJudgeConfig(config: Record<string, any>): boolean {
  const type = String(config.type || 'default')
  return resolveJudgeMode(config) === 'acm' && ['default', 'standard', 'objective'].includes(type)
}

export function allowedProblemLanguages(problem: { allowedLanguages: string | null; judgeConfig: string | null }): string[] {
  const config = parseJudgeConfig(problem.judgeConfig)
  if (Array.isArray(config.langs) && config.langs.length > 0) return config.langs.map(String)
  if (problem.allowedLanguages) {
    try {
      const parsed = JSON.parse(problem.allowedLanguages)
      if (Array.isArray(parsed)) {
        const languages = parsed.map(item => typeof item === 'string' ? item : item?.id).filter(Boolean).map(String)
        if (languages.length > 0) return languages
      }
    } catch {}
  }
  return ['c', 'c11', 'cpp', 'cpp11', 'cpp14', 'cpp17', 'cpp20']
}

function checkerHeader(): string {
  const candidates = [
    process.env.CHECKER_INCLUDE_DIR && path.join(process.env.CHECKER_INCLUDE_DIR, 'testlib.h'),
    path.join(process.cwd(), '..', 'judge', 'checker-includes', 'testlib.h'),
    path.join(process.cwd(), 'apps', 'judge', 'checker-includes', 'testlib.h'),
  ].filter(Boolean) as string[]
  const target = candidates.find(candidate => fs.existsSync(candidate))
  if (!target) throw new Error('系统 testlib.h 不可用')
  return fs.readFileSync(target, 'utf8')
}

export async function validateHackCppSource(source: string, label: string): Promise<void> {
  if (!source.trim()) throw new Error(`${label}源码不能为空`)
  if (Buffer.byteLength(source, 'utf8') > HACK_SOURCE_LIMIT) throw new Error(`${label}源码不能超过 256 KiB`)

  const sandboxHost = process.env.SANDBOX_HOST || 'http://127.0.0.1:5050'
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 70_000)
  try {
    const response = await fetch(`${sandboxHost}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        cmd: [{
          args: ['sh', '-c', 'g++ main.cpp -o main -O2 -std=c++17 -Wall 2>stderr'],
          env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
          copyIn: {
            'main.cpp': { content: source },
            'testlib.h': { content: checkerHeader() },
          },
          copyOut: ['stderr?'],
          cpuLimit: 60_000_000_000,
          clockLimit: 70_000_000_000,
          memoryLimit: 536_870_912,
          strictMemoryLimit: true,
          procLimit: 50,
        }],
      }),
    })
    if (!response.ok) throw new Error(`沙箱返回 HTTP ${response.status}`)
    const results = await response.json() as any[]
    const result = results?.[0]
    if (!result || result.exitStatus !== 0 || !['Accepted', 'File Error'].includes(result.status)) {
      const error = result?.files?.stderr || result?.error || result?.status || '编译失败'
      throw new Error(`${label}编译失败：${String(error).slice(0, 4000)}`)
    }
  } catch (error: any) {
    if (error?.name === 'AbortError') throw new Error(`${label}编译检查超时`)
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function problemDirectory(problemId: string): string {
  const root = path.resolve(TESTDATA_ROOT)
  const directory = path.resolve(root, problemId)
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) throw new Error('Invalid problem directory')
  return directory
}

function discoverCases(problemId: string): Array<{ input: string; output: string }> {
  const directory = problemDirectory(problemId)
  if (!fs.existsSync(directory)) return []
  const names = fs.readdirSync(directory)
  return names
    .filter(name => name.endsWith('.in') && !name.startsWith('.hack_pending_'))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
    .map(input => {
      const stem = input.slice(0, -3)
      const output = names.includes(`${stem}.out`) ? `${stem}.out` : `${stem}.ans`
      return { input, output }
    })
    .filter(item => names.includes(item.output))
}

function configuredCases(config: Record<string, any>, problemId: string): Array<Record<string, any>> {
  if (Array.isArray(config.cases) && config.cases.length > 0) return config.cases.map((item: any) => ({ ...item }))
  if (Array.isArray(config.subtasks)) {
    const seen = new Set<string>()
    const flattened = config.subtasks.flatMap((subtask: any) => subtask.cases || []).filter((item: any) => {
      const key = `${item.input}\0${item.output}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    if (flattened.length > 0) return flattened.map((item: any) => ({ input: item.input, output: item.output }))
  }
  return discoverCases(problemId)
}

export function appendHackCase(
  configText: string | null,
  problemId: string,
  testCase: { input: string; output: string },
): string {
  const config = parseJudgeConfig(configText)
  const cases = configuredCases(config, problemId).filter(item => item.input !== testCase.input)
  const hackCases = cases.filter(item => /^hack_[0-9a-f-]+\.in$/i.test(String(item.input)))
  const ordinaryCases = cases.filter(item => !/^hack_[0-9a-f-]+\.in$/i.test(String(item.input)))
  const next: Record<string, any> = { ...config, mode: 'acm', cases: [...hackCases, testCase, ...ordinaryCases] }
  delete next.subtasks
  return yaml.dump(next, { lineWidth: -1 })
}

async function withProblemLock<T>(problemId: string, action: () => Promise<T>): Promise<T> {
  const previous = problemLocks.get(problemId) || Promise.resolve()
  const current = previous.then(action, action)
  const settled = current.then(() => undefined, () => undefined)
  problemLocks.set(problemId, settled)
  try {
    return await current
  } finally {
    if (problemLocks.get(problemId) === settled) problemLocks.delete(problemId)
  }
}

export interface HackJudgeResultPayload {
  hackAttemptId: string
  outcome: 'accepted' | 'rejected' | 'system_error'
  baselineResult?: string
  candidateResult?: string
  message?: string
  inputData?: string
  outputData?: string
  inputSha256?: string
  outputSha256?: string
}

export async function finalizeHackResult(payload: HackJudgeResultPayload): Promise<void> {
  const attempt = await prisma.problemHackAttempt.findUnique({ where: { id: payload.hackAttemptId } })
  if (!attempt || attempt.status !== 'judging') return

  if (payload.outcome !== 'accepted') {
    await prisma.problemHackAttempt.update({
      where: { id: attempt.id },
      data: {
        status: payload.outcome,
        baselineResult: payload.baselineResult || null,
        candidateResult: payload.candidateResult || null,
        message: payload.message || null,
        judgeId: null,
        judgeStarted: null,
        finishedAt: new Date(),
      },
    })
    return
  }

  await withProblemLock(attempt.problemId, async () => {
    const current = await prisma.problemHackAttempt.findUnique({ where: { id: attempt.id } })
    if (!current || current.status !== 'judging') return
    const [problem, hackConfig] = await Promise.all([
      prisma.problem.findUnique({ where: { id: current.problemId } }),
      prisma.problemHackConfig.findUnique({ where: { problemId: current.problemId } }),
    ])
    if (!problem || !hackConfig || !hackConfig.enabled ||
        current.hackConfigRevision !== hackConfig.revision ||
        current.judgeConfigHash !== judgeConfigHash(problem.judgeConfig)) {
      await prisma.problemHackAttempt.update({
        where: { id: current.id },
        data: { status: 'stale', message: '题目评测配置已变化，请重新发起 Hack', judgeId: null, judgeStarted: null, finishedAt: new Date() },
      })
      return
    }

    const inputData = payload.inputData || ''
    const outputData = payload.outputData ?? ''
    if (!inputData.trim() || Buffer.byteLength(inputData, 'utf8') > HACK_INPUT_LIMIT || Buffer.byteLength(outputData, 'utf8') > HACK_INPUT_LIMIT) {
      await prisma.problemHackAttempt.update({
        where: { id: current.id },
        data: { status: 'system_error', message: 'Judge 返回的 Hack 数据无效或超过 1 MiB', judgeId: null, judgeStarted: null, finishedAt: new Date() },
      })
      return
    }

    const inputSha256 = crypto.createHash('sha256').update(inputData).digest('hex')
    const outputSha256 = crypto.createHash('sha256').update(outputData).digest('hex')
    if (payload.inputSha256 && payload.inputSha256 !== inputSha256) throw new Error('Hack input hash mismatch')
    if (payload.outputSha256 && payload.outputSha256 !== outputSha256) throw new Error('Hack output hash mismatch')

    const duplicate = await prisma.testdataFile.findFirst({
      where: { problemId: current.problemId, sha256: inputSha256, filename: { endsWith: '.in' } },
    })
    if (duplicate) {
      await prisma.problemHackAttempt.update({
        where: { id: current.id },
        data: {
          status: 'rejected',
          baselineResult: payload.baselineResult || null,
          candidateResult: payload.candidateResult || null,
          message: `候选输入与已有测试数据 ${duplicate.filename} 重复`,
          inputSha256,
          judgeId: null,
          judgeStarted: null,
          finishedAt: new Date(),
        },
      })
      return
    }

    const inputFile = `hack_${current.id}.in`
    const outputFile = `hack_${current.id}.out`
    const directory = problemDirectory(current.problemId)
    await fs.promises.mkdir(directory, { recursive: true })
    const stagedInput = path.join(directory, `.${inputFile}.pending`)
    const stagedOutput = path.join(directory, `.${outputFile}.pending`)
    const finalInput = path.join(directory, inputFile)
    const finalOutput = path.join(directory, outputFile)
    const nextProblemConfig = appendHackCase(problem.judgeConfig, problem.id, { input: inputFile, output: outputFile })

    const trainingProblems = await prisma.trainingProblem.findMany({
      where: { problemId: problem.id },
      select: { id: true, judgeConfigSnapshot: true, Training: { select: { format: true } } },
    })
    const acmSnapshots = trainingProblems.flatMap(item => {
      const source = item.judgeConfigSnapshot || problem.judgeConfig
      const parsed = parseJudgeConfig(source)
      const snapshotIsAcm = item.judgeConfigSnapshot
        ? isHackableJudgeConfig(parsed)
        : ['acm', 'icpc'].includes(String(item.Training.format).toLowerCase()) && isHackableJudgeConfig(parsed)
      return snapshotIsAcm
        ? [{ id: item.id, judgeConfigSnapshot: appendHackCase(source, problem.id, { input: inputFile, output: outputFile }) }]
        : []
    })

    await fs.promises.writeFile(stagedInput, inputData, 'utf8')
    await fs.promises.writeFile(stagedOutput, outputData, 'utf8')
    await fs.promises.rename(stagedInput, finalInput)
    await fs.promises.rename(stagedOutput, finalOutput)
    try {
      await prisma.$transaction(async tx => {
        await tx.problem.update({ where: { id: problem.id }, data: { judgeConfig: nextProblemConfig } })
        await tx.testdataFile.createMany({
          data: [
            { id: crypto.randomUUID(), problemId: problem.id, filename: inputFile, size: Buffer.byteLength(inputData), md5: crypto.createHash('md5').update(inputData).digest('hex'), sha256: inputSha256 },
            { id: crypto.randomUUID(), problemId: problem.id, filename: outputFile, size: Buffer.byteLength(outputData), md5: crypto.createHash('md5').update(outputData).digest('hex'), sha256: outputSha256 },
          ],
        })
        for (const item of acmSnapshots) {
          await tx.trainingProblem.update({ where: { id: item.id }, data: { judgeConfigSnapshot: item.judgeConfigSnapshot } })
        }
        await tx.problemHackAttempt.update({
          where: { id: current.id },
          data: {
            status: 'accepted',
            baselineResult: payload.baselineResult || null,
            candidateResult: payload.candidateResult || null,
            message: payload.message || '有效 Hack 数据已加入题目',
            inputSha256,
            outputSha256,
            acceptedInputFile: inputFile,
            acceptedOutputFile: outputFile,
            judgeId: null,
            judgeStarted: null,
            finishedAt: new Date(),
          },
        })
      })
    } catch (error) {
      await Promise.allSettled([fs.promises.rm(finalInput, { force: true }), fs.promises.rm(finalOutput, { force: true })])
      throw error
    }
  })
}
