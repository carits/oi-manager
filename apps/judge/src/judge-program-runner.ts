import crypto from 'node:crypto'
import { parseClassifierOutput } from '@oi-manager/shared'
import { execute } from './sandbox/client'

type Artifact = { fileId?: string; workDir?: string }
type RunInput = { language: string; artifact: Artifact; stdin: string; timeLimit: number; memoryLimit: number; outputLimit: number; args?: string[]; env?: Record<string, string> }

async function run(input: RunInput) {
  return execute({ language: input.language, stdin: input.stdin, timeLimit: input.timeLimit, memoryLimit: input.memoryLimit, outputLimit: input.outputLimit, compileFileId: input.artifact.fileId, workDir: input.artifact.workDir, args: input.args, env: input.env })
}

export async function runGeneratorProgram(input: RunInput & { deterministic: boolean }) {
  const first = await run(input)
  if (!input.deterministic || first.infrastructureError || first.status !== 'Accepted') return { first, deterministic: true, totalTime: first.time }
  const second = await run(input)
  const deterministic = second.status === 'Accepted' && crypto.createHash('sha256').update(first.stdout || '').digest('hex') === crypto.createHash('sha256').update(second.stdout || '').digest('hex')
  return { first, second, deterministic, totalTime: first.time + second.time }
}

export async function runValidatorProgram(input: RunInput) {
  const result = await run(input)
  return { result, valid: !result.infrastructureError && result.status === 'Accepted' && result.exitCode === 0 }
}

export async function runStandardProgram(input: RunInput) {
  const result = await run(input)
  return { result, output: result.stdout || '' }
}

export async function runClassifierProgram(input: RunInput & { knownSubtaskIds: number[] }) {
  const result = await run(input)
  if (result.infrastructureError || result.status !== 'Accepted' || result.exitCode !== 0) return { result, subtasks: null, error: result.stderr || result.status }
  try { return { result, subtasks: parseClassifierOutput(result.stdout || '', input.knownSubtaskIds), error: null } }
  catch (error) { return { result, subtasks: null, error: error instanceof Error ? error.message : 'Classifier 协议错误' } }
}
