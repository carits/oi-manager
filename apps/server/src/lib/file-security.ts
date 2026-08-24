import path from 'path'

const TEXT_EXTENSIONS = new Set([
  '.txt', '.cpp', '.c', '.py', '.java', '.pas', '.in', '.out', '.ans', '.md',
])

const MIME_BY_EXTENSION: Record<string, Set<string>> = {
  '.jpg': new Set(['image/jpeg']),
  '.jpeg': new Set(['image/jpeg']),
  '.png': new Set(['image/png']),
  '.gif': new Set(['image/gif']),
  '.webp': new Set(['image/webp']),
  '.pdf': new Set(['application/pdf']),
  '.zip': new Set(['application/zip', 'application/x-zip-compressed']),
  '.rar': new Set(['application/x-rar-compressed']),
  '.7z': new Set(['application/x-7z-compressed']),
  '.txt': new Set(['text/plain']),
  '.md': new Set(['text/plain']),
  '.in': new Set(['text/plain']),
  '.out': new Set(['text/plain']),
  '.ans': new Set(['text/plain']),
  '.cpp': new Set(['text/plain', 'text/x-c++src']),
  '.c': new Set(['text/plain', 'text/x-csrc']),
  '.py': new Set(['text/plain', 'text/x-python']),
  '.java': new Set(['text/plain', 'text/x-java-source']),
  '.pas': new Set(['text/plain', 'text/x-pascal']),
}

function hasPrefix(buffer: Buffer, prefix: number[], offset = 0): boolean {
  return prefix.every((byte, index) => buffer[offset + index] === byte)
}

/** Resolve an untrusted database path while keeping it inside storageRoot. */
export function resolveStoragePath(storageRoot: string, ...segments: string[]): string {
  const normalizedRoot = path.resolve(storageRoot)
  const resolved = path.resolve(normalizedRoot, ...segments)
  const relative = path.relative(normalizedRoot, resolved)

  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Invalid file path: potential path traversal attack')
  }

  return resolved
}

function isExpectedBinary(ext: string, buffer: Buffer): boolean {
  switch (ext) {
    case '.png':
      return hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    case '.jpg':
    case '.jpeg':
      return hasPrefix(buffer, [0xff, 0xd8, 0xff])
    case '.gif':
      return buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a'
    case '.webp':
      return buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    case '.pdf':
      return buffer.subarray(0, 5).toString('ascii') === '%PDF-'
    case '.zip':
      return hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04])
        || hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06])
        || hasPrefix(buffer, [0x50, 0x4b, 0x07, 0x08])
    case '.rar':
      return hasPrefix(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x00])
        || hasPrefix(buffer, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00])
    case '.7z':
      return hasPrefix(buffer, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
    default:
      return true
  }
}

function isReasonableText(buffer: Buffer): boolean {
  if (buffer.includes(0)) return false
  if (buffer.length === 0) return true

  let controls = 0
  for (const byte of buffer) {
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0d) controls += 1
  }
  return controls / buffer.length <= 0.02
}

/** Content validation complements extension and client-provided MIME checks. */
export function validateUploadedFileContent(buffer: Buffer, originalName: string): void {
  const ext = path.extname(originalName).toLowerCase()
  const valid = TEXT_EXTENSIONS.has(ext) ? isReasonableText(buffer) : isExpectedBinary(ext, buffer)
  if (!valid) throw new Error(`File content does not match extension: ${ext}`)
}

export function validateMimeForExtension(originalName: string, mimeType: string): void {
  const ext = path.extname(originalName).toLowerCase()
  const allowed = MIME_BY_EXTENSION[ext]
  if (allowed && !allowed.has(mimeType)) {
    throw new Error(`File MIME does not match extension: ${ext}`)
  }
}
