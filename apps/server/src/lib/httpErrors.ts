type BodyParserError = Error & {
  status?: number
  type?: string
  body?: unknown
}

export function isInvalidJsonBodyError(error: unknown): error is BodyParserError {
  if (!(error instanceof SyntaxError)) return false
  const candidate = error as BodyParserError
  return candidate.status === 400 && candidate.type === 'entity.parse.failed'
}
