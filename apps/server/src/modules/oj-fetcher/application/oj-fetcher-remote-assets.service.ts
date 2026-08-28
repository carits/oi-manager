import dns from 'dns/promises'
import net from 'net'
import path from 'path'
import { fileService } from '../../../lib/storage'
import logger from '../../../lib/logger'
import {
  findExistingProblemImage,
  replaceProblemAttachment,
  requireModifiableProblem,
} from './oj-fetcher-queue.service'

const MAX_REMOTE_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MAX_REMOTE_IMAGE_BYTES = 10 * 1024 * 1024

export class OjRemoteAssetError extends Error {
  constructor(public readonly statusCode: number, message: string) { super(message) }
}

export function isPrivateRemoteHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host === 'metadata.google.internal') return true
  if (net.isIP(host) === 4) {
    const octets = host.split('.').map(Number)
    return octets[0] === 10 || octets[0] === 127 || octets[0] === 0
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168)
  }
  if (net.isIP(host) === 6) {
    if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80:')) return true
    if (host.startsWith('::ffff:')) return isPrivateRemoteHost(host.slice('::ffff:'.length))
  }
  return false
}

export function validateRemoteUrl(rawUrl: string): URL {
  let url: URL
  try { url = new URL(rawUrl) } catch { throw new OjRemoteAssetError(400, '远程 URL 无效') }
  if (!['http:', 'https:'].includes(url.protocol)) throw new OjRemoteAssetError(400, '仅支持 HTTP(S) 远程 URL')
  if (isPrivateRemoteHost(url.hostname)) throw new OjRemoteAssetError(400, '禁止访问内网或本机地址')
  return url
}

export async function validateRemoteUrlAsync(rawUrl: string): Promise<URL> {
  const url = validateRemoteUrl(rawUrl)
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateRemoteHost(address))) {
    throw new OjRemoteAssetError(400, '禁止访问解析到内网或本机地址的远程 URL')
  }
  return url
}

function trustedHost(hostname: string, platform: string) {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  if (platform === 'luogu') return host === 'luogu.com.cn' || host.endsWith('.luogu.com.cn')
  if (platform === 'codeforces') return host === 'codeforces.com' || host.endsWith('.codeforces.com')
  return false
}

function safeHeaders(headers: Record<string, string>, url: URL, platform: string) {
  if (trustedHost(url.hostname, platform)) return headers
  const result = { ...headers }
  delete result.Cookie
  return result
}

async function readBody(response: Response, maxBytes: number) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new OjRemoteAssetError(413, '远程文件超过大小限制')
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    const chunk = Buffer.from(next.value)
    total += chunk.length
    if (total > maxBytes) {
      await reader.cancel()
      throw new OjRemoteAssetError(413, '远程文件超过大小限制')
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}

function mimeType(ext: string) {
  const types: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.pdf': 'application/pdf', '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed', '.7z': 'application/x-7z-compressed',
    '.cpp': 'text/x-c++src', '.c': 'text/x-csrc', '.py': 'text/x-python',
    '.java': 'text/x-java-source', '.pas': 'text/x-pascal', '.md': 'text/markdown',
    '.txt': 'text/plain', '.in': 'text/plain', '.out': 'text/plain', '.ans': 'text/plain',
  }
  return types[ext] || 'application/octet-stream'
}

async function downloadRemote(url: string, headers: Record<string, string>, platform: string, maxBytes: number) {
  let current = (await validateRemoteUrlAsync(url)).toString()
  const visited = new Set<string>()
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    if (visited.has(current)) throw new OjRemoteAssetError(502, '远程下载发生循环重定向')
    visited.add(current)
    const parsed = await validateRemoteUrlAsync(current)
    const response = await fetch(current, { headers: safeHeaders(headers, parsed, platform), redirect: 'manual' })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location || redirects === 5) throw new OjRemoteAssetError(502, '远程下载重定向失败')
      current = new URL(location, current).toString()
      continue
    }
    if (!response.ok) throw new OjRemoteAssetError(response.status === 403 ? 403 : 502, `下载失败: HTTP ${response.status}`)
    return { response, buffer: await readBody(response, maxBytes), finalUrl: current }
  }
  throw new OjRemoteAssetError(502, '远程下载失败')
}

function requestHeaders(platform: string, cookies: Record<string, string>) {
  const host = platform === 'luogu' ? 'luogu.com.cn' : `${platform}.com`
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/147 Safari/537.36',
    Accept: '*/*', 'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    Referer: `https://${host}/`, Origin: `https://${host}`,
  }
  if (cookies.__raw) headers.Cookie = cookies.__raw
  else if (Object.keys(cookies).length) headers.Cookie = Object.entries(cookies).map(([key, value]) => `${key}=${value}`).join('; ')
  return headers
}

export async function downloadAndStoreProblemAsset(params: {
  problemId: string
  url: string
  filename: string
  cookies: Record<string, string>
  platform: string
  publicImages?: boolean
}) {
  let filename = params.filename
  const requestedExt = path.extname(filename).toLowerCase()
  const requestedImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(requestedExt)
  const downloaded = await downloadRemote(
    params.url,
    requestHeaders(params.platform, params.cookies),
    params.platform,
    requestedImage ? MAX_REMOTE_IMAGE_BYTES : MAX_REMOTE_ATTACHMENT_BYTES,
  )
  if (!path.extname(filename)) {
    const disposition = downloaded.response.headers.get('content-disposition')
    const match = disposition?.match(/filename="?([^";]+)"?/i)
    if (match?.[1]) filename = path.basename(match[1].trim())
  }
  filename = path.basename(filename)
  const ext = path.extname(filename).toLowerCase()
  const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)
  const existingImage = isImage ? await findExistingProblemImage(params.problemId, filename) : null
  const uploaded = await fileService.upload(downloaded.buffer, {
    category: isImage ? 'image' : 'attachment', ownerType: 'problem', ownerId: params.problemId,
    originalName: filename, mimeType: mimeType(ext), isPublic: isImage && params.publicImages !== false,
  })
  try {
    if (isImage) {
      if (existingImage) await fileService.hardDelete(existingImage.id).catch(() => {})
      return { file: uploaded, attachment: null, isImage, filename, size: downloaded.buffer.length }
    }
    const replaced = await replaceProblemAttachment(
      params.problemId, filename, downloaded.buffer.length, uploaded.fileUrl,
      `从 ${params.platform} 下载的附件`,
    )
    if (replaced.oldFileId) await fileService.hardDelete(replaced.oldFileId).catch(() => {})
    return { file: uploaded, attachment: replaced.attachment, isImage, filename, size: downloaded.buffer.length }
  } catch (error) {
    await fileService.hardDelete(uploaded.id).catch(() => {})
    throw error
  }
}

export function extractImageLinks(markdown: string) {
  const images: Array<{ fullMatch: string; url: string }> = []
  for (const match of markdown.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)) {
    const url = match[2]
    if (/^https?:\/\//.test(url) && !url.includes('/api/files/')) images.push({ fullMatch: match[0], url })
  }
  return images
}

export async function processMarkdownImages(
  problemId: string,
  markdown: string,
  cookies: Record<string, string>,
  platform: string,
) {
  let result = markdown
  for (const image of extractImageLinks(markdown)) {
    try {
      const parsed = new URL(image.url)
      const ext = path.extname(parsed.pathname).toLowerCase()
      const filename = `image-${Date.now()}-${Math.round(Math.random() * 1e9)}${['.jpg','.jpeg','.png','.gif','.webp'].includes(ext) ? ext : '.jpg'}`
      const stored = await downloadAndStoreProblemAsset({
        problemId, url: image.url, filename, cookies, platform, publicImages: true,
      })
      result = result.replace(image.fullMatch, image.fullMatch.replace(image.url, stored.file.fileUrl))
    } catch (error) {
      logger.warn('oj_fetcher_image_download_failed', { action: 'oj_fetch', metadata: { problemId, url: image.url, error: String(error) } })
    }
  }
  return result
}

export async function downloadManualProblemAsset(user: any, input: { problemId: string; url: string; filename: string }) {
  const problem = await requireModifiableProblem(user, input.problemId)
  const cookieString = process.env.LUOGU_COOKIE || ''
  const cookies: Record<string, string> = cookieString ? { __raw: cookieString } : {}
  const stored = await downloadAndStoreProblemAsset({
    ...input, cookies, platform: 'luogu', publicImages: problem.libraryScope === 'platform',
  })
  return stored.attachment || {
    id: stored.file.id, fileName: stored.filename, fileSize: stored.size,
    fileUrl: stored.file.fileUrl, isImage: true,
  }
}
