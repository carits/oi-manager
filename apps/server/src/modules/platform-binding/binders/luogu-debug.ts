/**
 * Luogu Debug - 调试工具
 *
 * 职责：
 * 1. 保存异常 HTML 到磁盘
 * 2. 输出调试日志
 */

import fs from 'fs'
import path from 'path'

// 调试文件保存目录
const DEBUG_DIR = path.join(__dirname, '../../../../debug/luogu')

/**
 * 确保调试目录存在
 */
function ensureDebugDir(): void {
  if (!fs.existsSync(DEBUG_DIR)) {
    fs.mkdirSync(DEBUG_DIR, { recursive: true })
  }
}

/**
 * 保存调试 HTML 文件
 *
 * @param html - HTML 内容
 * @param filename - 文件名（不含扩展名）
 * @returns 保存的完整路径
 */
export function saveDebugHtml(html: string, filename: string): string {
  ensureDebugDir()

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const fullFilename = `${timestamp}_${filename}.html`
  const filepath = path.join(DEBUG_DIR, fullFilename)

  fs.writeFileSync(filepath, html, 'utf-8')

  return filepath
}

/**
 * 调试日志信息
 */
export interface DebugLogInfo {
  /** 轮次 */
  round?: number
  /** 类型 */
  type: string
  /** 预览内容 */
  preview?: string
  /** 额外数据 */
  [key: string]: any
}

/**
 * 输出调试日志
 *
 * @param info - 日志信息
 */
export function logDebugInfo(info: DebugLogInfo): void {
  const logData: Record<string, any> = {
    timestamp: new Date().toISOString(),
    ...info,
  }

  console.log('[Luogu Debug]', JSON.stringify(logData))
}

/**
 * 创建调试回调函数
 * 用于 fetchLuoguPage 的 onDebug 参数
 *
 * @param saveHtml - 是否保存 HTML 到文件
 * @returns 调试回调函数
 */
export function createDebugCallback(saveHtml: boolean = true): (info: { round: number; type: string; preview?: string }) => void {
  return (info: { round: number; type: string; preview?: string }) => {
    logDebugInfo(info)

    // 如果是挑战页或未知页面，保存 HTML 用于分析
    if (saveHtml && (info.type === 'challenge' || info.type === 'unknown' || info.type === 'challenge_no_c3vk')) {
      // 这里只记录，实际 HTML 由调用方处理
    }
  }
}

/**
 * 保存完整的请求结果用于分析
 *
 * @param result - fetchLuoguPage 返回的结果
 * @param prefix - 文件名前缀
 */
export function saveFetchResult(
  result: {
    success: boolean
    html: string
    cookies: Record<string, string>
    error?: string
    isChallenge: boolean
    retries: number
  },
  prefix: string = 'fetch'
): void {
  ensureDebugDir()

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const baseName = `${timestamp}_${prefix}`

  // 保存 HTML
  if (result.html) {
    const htmlPath = path.join(DEBUG_DIR, `${baseName}.html`)
    fs.writeFileSync(htmlPath, result.html, 'utf-8')
    logDebugInfo({ type: 'saved_html', path: htmlPath })
  }

  // 保存元数据
  const metaPath = path.join(DEBUG_DIR, `${baseName}_meta.json`)
  const meta = {
    timestamp: new Date().toISOString(),
    success: result.success,
    error: result.error,
    isChallenge: result.isChallenge,
    retries: result.retries,
    cookies: result.cookies,
    htmlLength: result.html?.length || 0,
  }
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
  logDebugInfo({ type: 'saved_meta', path: metaPath })
}

/**
 * 清理过期的调试文件（保留最近 N 个）
 *
 * @param keepCount - 保留的文件数量
 */
export function cleanOldDebugFiles(keepCount: number = 20): void {
  if (!fs.existsSync(DEBUG_DIR)) {
    return
  }

  const files = fs.readdirSync(DEBUG_DIR)
    .filter(f => f.endsWith('.html') || f.endsWith('.json'))
    .map(f => ({
      name: f,
      path: path.join(DEBUG_DIR, f),
      time: fs.statSync(path.join(DEBUG_DIR, f)).mtime.getTime(),
    }))
    .sort((a, b) => b.time - a.time)

  // 删除超出数量的文件
  const toDelete = files.slice(keepCount)
  for (const file of toDelete) {
    try {
      fs.unlinkSync(file.path)
      logDebugInfo({ type: 'cleaned_file', file: file.name })
    } catch (err) {
      // 忽略删除错误
    }
  }
}