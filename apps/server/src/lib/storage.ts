/**
 * 存储服务模块
 * 提供统一的文件存储接口，支持本地存储和未来扩展到 OSS
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../prisma'
import {
  STORAGE_ROOT,
  STORAGE_DIRS,
  getFullPath,
  getDirByCategory,
  getSizeLimit,
  ALLOWED_MIME_TYPES,
  ALLOWED_EXTENSIONS
} from '../config/storage'
import type { StorageType, AccessLevel, FileCategory, OwnerType } from '../config/storage'

// ==================== 类型定义 ====================

export interface UploadOptions {
  category: FileCategory
  ownerType: OwnerType
  ownerId: string
  originalName: string
  mimeType: string
  isPublic?: boolean
  description?: string
}

export interface UploadResult {
  id: string
  fileName: string
  originalName: string
  relativePath: string
  fileUrl: string
  fileSize: number
  mimeType: string
  md5Hash?: string
}

export interface StorageProvider {
  upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult>
  download(relativePath: string, fileName: string): Promise<Buffer>
  delete(relativePath: string, fileName: string): Promise<void>
  exists(relativePath: string, fileName: string): boolean
  getUrl(file: { storageType: string; relativePath: string; fileName: string; isPublic: boolean }): string
  move(oldPath: string, oldName: string, newPath: string, newName: string): Promise<void>
}

// ==================== 本地存储提供者 ====================

export class LocalStorageProvider implements StorageProvider {
  /**
   * 上传文件
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    const {
      category,
      ownerType,
      ownerId,
      originalName,
      mimeType,
      isPublic = false
    } = options

    // 获取目标目录
    const relativePath = getDirByCategory(category, isPublic)
    const targetDir = getFullPath(relativePath)

    // 确保目录存在
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // 生成安全文件名
    const fileName = this.generateSafeFileName(originalName)

    // 写入文件
    const filePath = path.join(targetDir, fileName)
    fs.writeFileSync(filePath, buffer)

    // 计算 MD5
    const md5Hash = this.calculateMd5(buffer)

    // 创建数据库记录
    const file = await prisma.file.create({
      data: {
        storageType: 'local',
        disk: 'default',
        relativePath,
        fileName,
        originalName,
        mimeType,
        fileSize: buffer.length,
        md5Hash,
        accessLevel: isPublic ? 'public' : 'private',
        isPublic,
        ownerType,
        ownerId,
        category,
        status: 'active'
      }
    })

    // 生成访问 URL
    const fileUrl = this.getUrl(file)

    return {
      id: file.id,
      fileName,
      originalName,
      relativePath,
      fileUrl,
      fileSize: buffer.length,
      mimeType,
      md5Hash
    }
  }

  /**
   * 下载文件
   */
  async download(relativePath: string, fileName: string): Promise<Buffer> {
    const filePath = this.getPhysicalPath(relativePath, fileName)

    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found: ${filePath}`)
    }

    return fs.readFileSync(filePath)
  }

  /**
   * 删除文件（移动到回收站）
   */
  async delete(relativePath: string, fileName: string): Promise<void> {
    const sourcePath = this.getPhysicalPath(relativePath, fileName)

    if (!fs.existsSync(sourcePath)) {
      return // 文件不存在，直接返回
    }

    // 移动到回收站
    const today = new Date().toISOString().split('T')[0]
    const trashDir = getFullPath(`${STORAGE_DIRS.trash}/${today}`)

    if (!fs.existsSync(trashDir)) {
      fs.mkdirSync(trashDir, { recursive: true })
    }

    const trashPath = path.join(trashDir, fileName)
    fs.renameSync(sourcePath, trashPath)
  }

  /**
   * 检查文件是否存在
   */
  exists(relativePath: string, fileName: string): boolean {
    const filePath = this.getPhysicalPath(relativePath, fileName)
    return fs.existsSync(filePath)
  }

  /**
   * 获取访问 URL
   */
  getUrl(file: { storageType: string; relativePath: string; fileName: string; isPublic: boolean; id?: string }): string {
    if (file.storageType === 'local') {
      // 公开文件返回静态路径（支持缓存）
      if (file.isPublic) {
        return `/uploads/${file.relativePath}/${file.fileName}`
      }
      // 私有文件通过 API 访问（支持认证和下载响应头）
      return `/api/files/${file.id}/download`
    }
    // OSS 等其他存储类型可以在这里扩展
    return `/api/files/${file.id}/download`
  }

  /**
   * 移动文件
   */
  async move(oldPath: string, oldName: string, newPath: string, newName: string): Promise<void> {
    const sourcePath = this.getPhysicalPath(oldPath, oldName)
    const targetDir = getFullPath(newPath)

    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file not found: ${sourcePath}`)
    }

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const targetPath = path.join(targetDir, newName)
    fs.renameSync(sourcePath, targetPath)
  }

  // ==================== 私有方法 ====================

  /**
   * 获取物理路径
   */
  private getPhysicalPath(relativePath: string, fileName: string): string {
    // 安全检查：防止路径穿越
    const fullPath = path.resolve(STORAGE_ROOT, relativePath, fileName)
    const normalizedRoot = path.resolve(STORAGE_ROOT)

    if (!fullPath.startsWith(normalizedRoot)) {
      throw new Error('Invalid file path: potential path traversal attack')
    }

    return fullPath
  }

  /**
   * 生成安全文件名
   */
  private generateSafeFileName(originalName: string): string {
    const timestamp = Date.now()
    const random = Math.round(Math.random() * 1e9)
    const ext = path.extname(originalName).toLowerCase()

    return `${timestamp}-${random}${ext}`
  }

  /**
   * 计算 MD5 哈希
   */
  private calculateMd5(buffer: Buffer): string {
    return crypto.createHash('md5').update(buffer).digest('hex')
  }
}

// ==================== 存储服务 ====================

class FileService {
  private provider: StorageProvider

  constructor() {
    // 目前只支持本地存储
    this.provider = new LocalStorageProvider()
  }

  /**
   * 上传文件
   */
  async upload(buffer: Buffer, options: UploadOptions): Promise<UploadResult> {
    // 验证文件类型
    this.validateFileType(options.originalName, options.mimeType, options.category)

    // 验证文件大小
    this.validateFileSize(buffer.length, options.category)

    return this.provider.upload(buffer, options)
  }

  /**
   * 上传文件（从 Multer 文件对象）
   */
  async uploadFromMulter(
    file: Express.Multer.File,
    options: Omit<UploadOptions, 'originalName' | 'mimeType'>
  ): Promise<UploadResult> {
    const buffer = fs.readFileSync(file.path)

    const result = await this.upload(buffer, {
      ...options,
      originalName: file.originalname,
      mimeType: file.mimetype
    })

    // 删除临时文件
    fs.unlinkSync(file.path)

    return result
  }

  /**
   * 下载文件
   */
  async download(fileId: string): Promise<{ buffer: Buffer; originalName: string; mimeType: string }> {
    const file = await prisma.file.findUnique({
      where: { id: fileId }
    })

    if (!file) {
      throw new Error('File not found')
    }

    if (file.status !== 'active') {
      throw new Error('File is not available')
    }

    const buffer = await this.provider.download(file.relativePath, file.fileName)

    return {
      buffer,
      originalName: file.originalName,
      mimeType: file.mimeType
    }
  }

  /**
   * 软删除文件
   */
  async softDelete(fileId: string): Promise<void> {
    const file = await prisma.file.findUnique({
      where: { id: fileId }
    })

    if (!file) {
      return
    }

    // 移动到回收站
    await this.provider.delete(file.relativePath, file.fileName)

    // 更新数据库状态
    await prisma.file.update({
      where: { id: fileId },
      data: {
        status: 'deleted',
        deletedAt: new Date()
      }
    })
  }

  /**
   * 硬删除文件（真删除）
   */
  async hardDelete(fileId: string): Promise<void> {
    const file = await prisma.file.findUnique({
      where: { id: fileId }
    })

    if (!file) {
      return
    }

    // 删除物理文件
    const filePath = path.join(STORAGE_ROOT, file.relativePath, file.fileName)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除数据库记录
    await prisma.file.delete({
      where: { id: fileId }
    })
  }

  /**
   * 获取文件信息
   */
  async getFile(fileId: string) {
    return prisma.file.findUnique({
      where: { id: fileId }
    })
  }

  /**
   * 根据业务对象获取文件列表
   */
  async getFilesByOwner(ownerType: OwnerType, ownerId: string, category?: FileCategory) {
    const where: any = {
      ownerType,
      ownerId,
      status: 'active'
    }

    if (category) {
      where.category = category
    }

    return prisma.file.findMany({
      where,
      orderBy: { createdAt: 'desc' }
    })
  }

  /**
   * 获取文件 URL
   */
  getFileUrl(file: { id: string; storageType: string; relativePath: string; fileName: string; isPublic: boolean }): string {
    if (file.isPublic) {
      return this.provider.getUrl(file)
    }
    // 私有文件通过 API 访问
    return `/api/files/${file.id}/download`
  }

  /**
   * 检查文件访问权限
   */
  async checkAccess(userId: string, userRole: string, fileId: string): Promise<boolean> {
    const file = await prisma.file.findUnique({
      where: { id: fileId }
    })

    if (!file) {
      return false
    }

    // 公开文件允许访问
    if (file.isPublic) {
      return true
    }

    // 根据业务类型检查权限
    switch (file.ownerType) {
      case 'problem': {
        // 检查题目可见性
        const problem = await prisma.problem.findUnique({
          where: { id: file.ownerId }
        })
        if (!problem) return false
        if (problem.visibility === 'public') return true
        // 私有题目只有所有者和管理员可以访问
        if (userRole === 'super_admin' || userRole === 'platform_admin') return true
        // 检查是否是所有者
        // 这里需要根据具体业务逻辑实现
        return false
      }
      case 'contest':
        // 比赛资源：检查是否是参与者
        // TODO: 实现比赛参与检查
        return true
      case 'team':
        // 团队资源：检查是否是团队成员
        // TODO: 实现团队成员检查
        return true
      case 'user':
        // 用户资源：只有本人和管理员可以访问
        if (userRole === 'super_admin' || userRole === 'platform_admin') return true
        return file.ownerId === userId
      default:
        return false
    }
  }

  // ==================== 私有方法 ====================

  /**
   * 验证文件类型
   */
  private validateFileType(originalName: string, mimeType: string, category: FileCategory): void {
    const ext = path.extname(originalName).toLowerCase()

    // avatar 和 image 都使用 image 的扩展名和 MIME 类型
    const effectiveCategory = (category === 'avatar') ? 'image' : category
    const allowedExts = ALLOWED_EXTENSIONS[effectiveCategory] || ALLOWED_EXTENSIONS.attachment
    const allowedMimes = ALLOWED_MIME_TYPES[effectiveCategory] || ALLOWED_MIME_TYPES.attachment

    if (!allowedExts.includes(ext)) {
      throw new Error(`File extension not allowed: ${ext}`)
    }

    if (!allowedMimes.includes(mimeType)) {
      throw new Error(`File type not allowed: ${mimeType}`)
    }
  }

  /**
   * 验证文件大小
   */
  private validateFileSize(size: number, category: string): void {
    const limit = getSizeLimit(category)

    if (size > limit) {
      throw new Error(`File size exceeds limit: ${size} > ${limit}`)
    }
  }
}

// 导出单例
export const fileService = new FileService()

// 导出提供者工厂函数（未来扩展用）
export function getStorageProvider(type: StorageType): StorageProvider {
  switch (type) {
    case 'local':
      return new LocalStorageProvider()
    // case 'oss':
    //   return new OSSStorageProvider()
    default:
      throw new Error(`Unknown storage type: ${type}`)
  }
}