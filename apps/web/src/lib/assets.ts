/**
 * 资源 URL 辅助函数
 * 用于头像、图片、文件下载等静态资源
 */

import { ENV } from '@/config/env'

/**
 * 获取资源完整 URL
 * @param path 资源路径，如 /uploads/avatars/xxx.png
 * @returns 完整 URL，空路径返回空字符串
 */
export function getAssetUrl(path: string | null | undefined): string {
  if (!path) return ''
  // 已经是完整 URL 直接返回
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path
  }
  // 确保路径以 / 开头
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
