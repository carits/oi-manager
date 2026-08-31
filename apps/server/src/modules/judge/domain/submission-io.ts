const SAFE_FILENAME = /^[A-Za-z0-9_.-]{1,128}$/
const RESERVED_FILENAMES = new Set([
  '.', '..', 'main', 'main.c', 'main.cpp', 'main.py', 'stdin', 'stdout', 'stderr', 'checker', 'answer', 'user_out',
])

export class SubmissionIoError extends Error {
  constructor(
    public readonly code: 'INVALID_SUBMISSION_IO' | 'SUBMISSION_IO_UNSUPPORTED',
    message: string,
  ) {
    super(message)
    this.name = 'SubmissionIoError'
  }
}

function normalizeFilename(value: unknown, label: string): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new SubmissionIoError('INVALID_SUBMISSION_IO', `${label}必须是文件名`)
  const filename = value.trim()
  if (!filename) return null
  if (!SAFE_FILENAME.test(filename) || filename.includes('..') || RESERVED_FILENAMES.has(filename.toLowerCase())) {
    throw new SubmissionIoError(
      'INVALID_SUBMISSION_IO',
      `${label}只能使用 1～128 位字母、数字、点、下划线或连字符，且不能是路径或沙箱保留名`,
    )
  }
  return filename
}

export function normalizeSubmissionIo(input: {
  inputFilename?: unknown
  outputFilename?: unknown
  problemType?: unknown
}) {
  const inputFilename = normalizeFilename(input.inputFilename, '输入文件名')
  const outputFilename = normalizeFilename(input.outputFilename, '输出文件名')
  if (inputFilename && outputFilename && inputFilename === outputFilename) {
    throw new SubmissionIoError('INVALID_SUBMISSION_IO', '输入文件名和输出文件名不能相同')
  }
  const problemType = typeof input.problemType === 'string' ? input.problemType : 'default'
  if ((inputFilename || outputFilename) && !['default', 'standard'].includes(problemType)) {
    throw new SubmissionIoError('SUBMISSION_IO_UNSUPPORTED', '当前题型不支持提交级文件输入输出')
  }
  return { inputFilename, outputFilename, ioAdapterVersion: 1 as const }
}

export function legacySubmissionIoSuggestion(config: any) {
  if (!config || (config.type && !['default', 'standard'].includes(config.type)) || typeof config.filename !== 'string') return null
  const prefix = config.filename.trim()
  if (!prefix) return null
  try {
    return normalizeSubmissionIo({ inputFilename: `${prefix}.in`, outputFilename: `${prefix}.out`, problemType: 'default' })
  } catch {
    return null
  }
}

export function resolveSubmissionIoSnapshot(
  snapshot: { inputFilename?: string | null; outputFilename?: string | null; ioAdapterVersion?: number | null },
  config: any,
) {
  if ((snapshot.ioAdapterVersion ?? 0) >= 1) {
    return {
      inputFile: snapshot.inputFilename || null,
      outputFile: snapshot.outputFilename || null,
      ioAdapterVersion: 1 as const,
    }
  }
  const legacy = legacySubmissionIoSuggestion(config)
  return {
    inputFile: legacy?.inputFilename || null,
    outputFile: legacy?.outputFilename || null,
    ioAdapterVersion: 0 as const,
  }
}

export function submissionIoDto(inputFilename?: string | null, outputFilename?: string | null) {
  return {
    input: inputFilename ? { type: 'file' as const, filename: inputFilename } : { type: 'stdin' as const },
    output: outputFilename ? { type: 'file' as const, filename: outputFilename } : { type: 'stdout' as const },
  }
}
