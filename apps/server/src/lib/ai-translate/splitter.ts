/**
 * splitter.ts — 长文本分块
 *
 * 按段落边界拆分，不在代码块/公式中间切割。
 * 样例解释与对应样例尽量在同一块。
 */

export interface SplitOptions {
  /** 单块最大字符数，默认 3000 */
  maxChunkSize?: number
  /** 单块最小字符数（避免过碎），默认 200 */
  minChunkSize?: number
}

/**
 * 检测文本中是否处于代码块/公式内部
 */
function inProtectedBlock(lines: string[], lineIndex: number): boolean {
  let inCode = false
  let inMath = false

  for (let i = 0; i <= lineIndex; i++) {
    const line = lines[i]
    // Fenced code block 边界
    if (line.match(/^```|^~~~/)) {
      inCode = !inCode
    }
    // Display math 边界（简化：独立一行的 $$）
    if (line.trim() === '$$') {
      inMath = !inMath
    }
  }

  return inCode || inMath
}

/**
 * 将文本按段落边界分块
 *
 * @param text 待分块的文本
 * @param options 分块选项
 * @returns 文本块数组
 */
export function splitText(
  text: string,
  options: SplitOptions = {}
): string[] {
  const { maxChunkSize = 3000, minChunkSize = 200 } = options

  // 短文本不需要分块
  if (text.length <= maxChunkSize) {
    return [text]
  }

  const lines = text.split('\n')
  const chunks: string[] = []
  let currentChunk: string[] = []
  let currentSize = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineSize = line.length + 1 // +1 for \n

    // 如果在保护块内部，不能切分，强制加入当前块
    if (inProtectedBlock(lines, i)) {
      currentChunk.push(line)
      currentSize += lineSize
      continue
    }

    // 当前行为空行（段落边界）且当前块已经够大
    if (line.trim() === '' && currentSize >= minChunkSize && currentSize + lineSize > maxChunkSize) {
      // 保存当前块
      chunks.push(currentChunk.join('\n'))
      currentChunk = []
      currentSize = 0
      continue
    }

    // 如果加入此行会超出大小限制，且当前块非空
    if (currentSize > 0 && currentSize + lineSize > maxChunkSize && currentSize >= minChunkSize) {
      chunks.push(currentChunk.join('\n'))
      currentChunk = []
      currentSize = 0
    }

    currentChunk.push(line)
    currentSize += lineSize
  }

  // 处理最后一块
  if (currentChunk.length > 0) {
    const lastChunk = currentChunk.join('\n')
    if (lastChunk.trim().length > 0) {
      // 如果最后一块太小，尝试合并到前一块
      if (chunks.length > 0 && lastChunk.length < minChunkSize) {
        chunks[chunks.length - 1] += '\n' + lastChunk
      } else {
        chunks.push(lastChunk)
      }
    }
  }

  return chunks
}
