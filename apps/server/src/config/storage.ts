/**
 * 文件存储配置
 * 定义存储根目录、各类文件目录、大小限制等
 */

import path from 'path'

// 存储根目录
export const STORAGE_ROOT = process.env.STORAGE_ROOT || path.join(__dirname, '../../uploads')

// 存储类型
export type StorageType = 'local' | 'oss' | 's3'

// 访问级别
export type AccessLevel = 'public' | 'private' | 'protected'

// 文件类别
export type FileCategory = 'pdf' | 'attachment' | 'avatar' | 'image' | 'testdata'

// 业务归属类型
export type OwnerType = 'problem' | 'contest' | 'user' | 'team' | 'attachment' | 'training_content'

// 目录配置
export const STORAGE_DIRS = {
  // 公开访问目录
  public: {
    avatars: 'public/avatars',           // 头像
    problemImages: 'public/problem-images', // 题面图片
    contestAssets: 'public/contest-assets'  // 比赛公开资源
  },
  // 私有访问目录
  private: {
    problemImages: 'private/problem-images',
    problemPdfs: 'private/problem-pdfs',         // 题面/题解 PDF
    problemAttachments: 'private/problem-attachments', // 题目附件
    contestAttachments: 'private/contest-attachments', // 比赛私有资源
    teamAttachments: 'private/team-attachments',   // 团队附件
    exports: 'private/exports'                      // 导出文件
  },
  // 临时目录
  temp: {
    uploads: 'temp/uploads',   // 上传缓存
    unzip: 'temp/unzip',       // 解压目录
    convert: 'temp/convert'    // 格式转换
  },
  // 回收站
  trash: 'trash/pending-delete',
  // 评测目录
  judge: {
    problems: 'judge/problems',     // 题目测试数据
    submissions: 'judge/submissions', // 提交源码
    workdir: 'judge/workdir',       // 评测工作目录
    cache: 'judge/cache'            // 编译缓存
  }
} as const

// 大小限制（字节）
export const SIZE_LIMITS: Record<string, number> = {
  avatar: 2 * 1024 * 1024,          // 2MB
  pdf: 20 * 1024 * 1024,            // 20MB
  attachment: 50 * 1024 * 1024,     // 50MB
  testdata: 100 * 1024 * 1024,      // 100MB
  sourceCode: 64 * 1024,            // 64KB
  image: 10 * 1024 * 1024           // 10MB
} as const

// 允许的 MIME 类型
export const ALLOWED_MIME_TYPES: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
  pdf: ['application/pdf'],
  attachment: [
    'application/pdf',
    'application/zip',
    'application/x-zip-compressed',
    'application/x-rar-compressed',
    'application/x-7z-compressed',
    'text/plain',
    'text/x-c++src',
    'text/x-csrc',
    'text/x-python',
    'text/x-java-source',
    'text/x-pascal'
  ],
  testdata: [
    'application/zip',
    'application/x-zip-compressed',
    'text/plain'
  ]
} as const

// 允许的扩展名
export const ALLOWED_EXTENSIONS: Record<string, string[]> = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  pdf: ['.pdf'],
  attachment: ['.pdf', '.zip', '.rar', '.7z', '.txt', '.cpp', '.c', '.py', '.java', '.pas', '.in', '.out', '.ans', '.md'],
  testdata: ['.zip', '.in', '.out', '.ans'],
  sourceCode: ['.cpp', '.c', '.py', '.java', '.pas']
} as const

// 清理配置
export const CLEANUP_CONFIG = {
  tempFileRetentionHours: parseInt(process.env.TEMP_FILE_CLEANUP_HOURS || '24', 10),
  trashRetentionDays: parseInt(process.env.TRASH_RETENTION_DAYS || '7', 10)
} as const

// 获取完整路径
export function getFullPath(dir: string, filename?: string): string {
  if (filename) {
    return path.join(STORAGE_ROOT, dir, filename)
  }
  return path.join(STORAGE_ROOT, dir)
}

// 根据类别获取目录
export function getDirByCategory(category: FileCategory, isPublic: boolean = false): string {
  switch (category) {
    case 'avatar':
      return STORAGE_DIRS.public.avatars
    case 'image':
      return isPublic ? STORAGE_DIRS.public.problemImages : STORAGE_DIRS.private.problemImages
    case 'pdf':
      return STORAGE_DIRS.private.problemPdfs
    case 'attachment':
      return isPublic ? STORAGE_DIRS.public.contestAssets : STORAGE_DIRS.private.problemAttachments
    case 'testdata':
      return STORAGE_DIRS.judge.problems
    default:
      return STORAGE_DIRS.private.problemAttachments
  }
}

// 获取大小限制
export function getSizeLimit(category: string): number {
  return SIZE_LIMITS[category] || SIZE_LIMITS.attachment
}
