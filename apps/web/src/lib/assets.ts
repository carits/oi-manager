/**
 * 资源 URL 辅助函数
 * 用于头像、图片、文件下载等静态资源
 */

import { ENV } from '@/config/env'

/**
 * 获取资源完整 URL
 * @param path 资源路径，如 /uploads/avatars/xxx.png 或 /api/files/xxx/download
 * @returns 完整 URL，空路径返回空字符串
 */
export function getAssetUrl(path: string | null | undefined): string {
  if (!path) return ''
  // 已经是完整 URL 直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  // 新的 File API URL 格式（/api/files/:id/public 或 /api/files/:id/download）
  if (path.startsWith('/api/files/')) {
    return `${ENV.API_URL}${path}`
  }
  // 旧的 /uploads/ 格式（兼容）
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return `${ENV.API_URL}${normalizedPath}`
}

/**
 * 获取头像 URL
 * @param avatar 头像路径
 * @returns 完整 URL 或空字符串
 */
export function getAvatarUrl(avatar: string | null | undefined): string {
  return getAssetUrl(avatar)
}

/**
 * 获取文件下载 URL（需认证）
 * @param fileId 文件 ID
 * @returns 下载 URL
 */
export function getFileDownloadUrl(fileId: string): string {
  return `${ENV.API_URL}/api/files/${fileId}/download`
}

/**
 * 获取公开文件 URL（无需认证）
 * @param fileId 文件 ID
 * @returns 公开访问 URL
 */
export function getPublicFileUrl(fileId: string): string {
  return `${ENV.API_URL}/api/files/${fileId}/public`
}
