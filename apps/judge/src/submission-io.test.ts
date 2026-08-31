import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const compileMock = vi.hoisted(() => vi.fn())
const executeMock = vi.hoisted(() => vi.fn())
vi.mock('./sandbox/client', () => ({
  isLocalMode: () => false,
  compile: compileMock,
  execute: executeMock,
  deleteFile: vi.fn(async () => {}),
  runCommand: vi.fn(),
  runPiped: vi.fn(),
}))

import { judge } from './judge'

let directory = ''
beforeEach(() => {
  compileMock.mockReset().mockResolvedValue({ success: true, fileId: 'compiled' })
  executeMock.mockReset().mockResolvedValue({ status: 'Accepted', time: 1, memory: 1, exitCode: 0, stdout: '' })
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'submission-io-test-'))
  fs.writeFileSync(path.join(directory, '1.in'), '1 2\n')
  fs.writeFileSync(path.join(directory, '1.out'), '3\n')
})
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }))

describe('submission IO adapter in judge', () => {
  it('passes independent input and output filenames to the sandbox', async () => {
    executeMock.mockResolvedValue({ status: 'Accepted', time: 1, memory: 1, exitCode: 0, stdout: '3\n' })
    await judge({ submissionId: '1', problemId: 'p', language: 'cpp17', code: 'int main(){}', testdataPath: directory, config: { mode: 'acm', cases: [{ input: '1.in', output: '1.out' }] }, ioAdapterVersion: 1, io: { inputFile: 'travel.in', outputFile: 'answer.txt' } })
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ inputFile: 'travel.in', outputFile: 'answer.txt', stdin: '1 2\n' }))
  })

  it('records a missing named output as a checker result diagnostic', async () => {
    executeMock.mockResolvedValue({ status: 'Accepted', time: 1, memory: 1, exitCode: 0, stdout: '', outputFileMissing: true })
    const result = await judge({ submissionId: '2', problemId: 'p', language: 'cpp17', code: 'int main(){}', testdataPath: directory, config: { mode: 'acm', cases: [{ input: '1.in', output: '1.out' }] }, ioAdapterVersion: 1, io: { inputFile: null, outputFile: 'missing.out' } })
    expect(result.result).toBe('Wrong Answer')
    expect(result.cases[0]).toMatchObject({ outputFileMissing: true })
    expect(result.cases[0].message).toContain('missing.out')
  })

  it('preserves legacy filename only when no explicit task IO is present', async () => {
    executeMock.mockResolvedValue({ status: 'Accepted', time: 1, memory: 1, exitCode: 0, stdout: '3\n' })
    await judge({ submissionId: '3', problemId: 'p', language: 'cpp17', code: 'int main(){}', testdataPath: directory, config: { mode: 'acm', filename: 'legacy', cases: [{ input: '1.in', output: '1.out' }] } })
    expect(executeMock).toHaveBeenCalledWith(expect.objectContaining({ inputFile: 'legacy.in', outputFile: 'legacy.out' }))
  })
})
