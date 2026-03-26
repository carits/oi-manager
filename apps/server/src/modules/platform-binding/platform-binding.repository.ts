/**
 * Platform Binding Module - Repository Layer
 * 平台绑定模块数据访问层
 */

import { prisma } from '../../prisma'
import type { BindingPlatform, BindingStatus, PlatformBindingRecord } from './platform-binding.types'

/**
 * 平台绑定数据访问层
 * 封装所有数据库操作
 */
export class PlatformBindingRepository {
  // ==================== 查询操作 ====================

  /**
   * 获取用户的所有平台绑定
   */
  async findByUserId(userId: string): Promise<PlatformBindingRecord[]> {
    return prisma.userPlatformBinding.findMany({
      where: { userId }
    })
  }

  /**
   * 获取用户的指定平台绑定
   */
  async findByUserAndPlatform(
    userId: string,
    platform: BindingPlatform
  ): Promise<PlatformBindingRecord | null> {
    return prisma.userPlatformBinding.findUnique({
      where: {
        userId_platform: { userId, platform }
      }
    })
  }

  /**
   * 根据 ID 获取绑定记录
   */
  async findById(id: string): Promise<PlatformBindingRecord | null> {
    return prisma.userPlatformBinding.findUnique({
      where: { id }
    })
  }

  // ==================== 创建操作 ====================

  /**
   * 创建绑定记录
   */
  async create(params: {
    userId: string
    platform: BindingPlatform
    platformUsername?: string
    bindingStatus?: BindingStatus
    bindingData?: string
  }): Promise<PlatformBindingRecord> {
    return prisma.userPlatformBinding.create({
      data: {
        id: crypto.randomUUID(),
        userId: params.userId,
        platform: params.platform,
        platformUsername: params.platformUsername || null,
        bindingStatus: params.bindingStatus || 'pending',
        bindingData: params.bindingData || null,
        updatedAt: new Date()
      }
    })
  }

  // ==================== 更新操作 ====================

  /**
   * 更新绑定记录
   */
  async update(
    userId: string,
    platform: BindingPlatform,
    params: {
      platformUsername?: string
      bindingStatus?: BindingStatus
      bindingData?: string
      verifiedAt?: Date | null
    }
  ): Promise<PlatformBindingRecord> {
    return prisma.userPlatformBinding.update({
      where: {
        userId_platform: { userId, platform }
      },
      data: {
        ...params,
        updatedAt: new Date()
      }
    })
  }

  // ==================== 删除操作 ====================

  /**
   * 删除绑定记录
   */
  async delete(userId: string, platform: BindingPlatform): Promise<void> {
    await prisma.userPlatformBinding.delete({
      where: {
        userId_platform: { userId, platform }
      }
    })
  }

  /**
   * 重置绑定状态为未绑定
   */
  async reset(userId: string, platform: BindingPlatform): Promise<PlatformBindingRecord> {
    return prisma.userPlatformBinding.update({
      where: {
        userId_platform: { userId, platform }
      },
      data: {
        platformUsername: null,
        bindingStatus: 'unbound',
        bindingData: null,
        verifiedAt: null,
        updatedAt: new Date()
      }
    })
  }

  // ==================== upsert 操作 ====================

  /**
   * 创建或更新绑定记录
   */
  async upsert(params: {
    userId: string
    platform: BindingPlatform
    platformUsername?: string
    bindingStatus?: BindingStatus
    bindingData?: string
    verifiedAt?: Date | null
  }): Promise<PlatformBindingRecord> {
    return prisma.userPlatformBinding.upsert({
      where: {
        userId_platform: { userId: params.userId, platform: params.platform }
      },
      update: {
        platformUsername: params.platformUsername || null,
        bindingStatus: params.bindingStatus || 'pending',
        bindingData: params.bindingData || null,
        verifiedAt: params.verifiedAt || null,
        updatedAt: new Date()
      },
      create: {
        id: crypto.randomUUID(),
        userId: params.userId,
        platform: params.platform,
        platformUsername: params.platformUsername || null,
        bindingStatus: params.bindingStatus || 'pending',
        bindingData: params.bindingData || null,
        verifiedAt: params.verifiedAt || null,
        updatedAt: new Date()
      }
    })
  }
}