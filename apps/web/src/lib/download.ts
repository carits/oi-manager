export function filenameFromContentDisposition(
  contentDisposition: string | undefined,
  fallback: string,
): string {
  if (!contentDisposition) return fallback

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''(.+?)(?:;|$)/i)
  if (utf8Match?.[1]) {
    try {
      return decodeURIComponent(utf8Match[1].trim())
    } catch {
      return utf8Match[1].trim()
    }
  }

  const asciiMatch = contentDisposition.match(/filename="?([^";\n]+)"?/i)
  return asciiMatch?.[1]?.trim() || fallback
}

export function csvCell(value: unknown): string {
  const raw = String(value ?? '')
  const startsWithControl = /^[\t\r\n]/.test(raw)
  const startsWithFormula = /^[=+\-@]/.test(raw.trimStart())
  const safe = startsWithControl || startsWithFormula ? `'${raw}` : raw
  return `"${safe.replaceAll('"', '""')}"`
}

export function saveBlobDownload(blob: Blob, filename: string): void {
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}
