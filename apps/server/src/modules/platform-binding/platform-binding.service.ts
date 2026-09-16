/**
 * Platform Binding Module - Service Layer
 * 平台绑定模块业务逻辑层
 */

import logger from '../../lib/logger'
import { PlatformBindingRepository } from './platform-binding.repository'
import { getBinder, getSupportedPlatforms } from './binders'
import { getLuoguConfigSchema } from './binders/luogu'
import { getVJudgeConfigSchema } from './binders/vjudge'
import { getCodeforcesConfigSchema } from './binders/codeforces'
import type {
  BindingPlatform,
  PlatformBindingResponse,
  PlatformConfig,
  PlatformConfigSchema,
  UserIdentity,
  BindRequest,
  BindResult,
  UnbindResult
} from './platform-binding.types'

/**
 * 平台绑定业务逻辑层
 */
export class PlatformBindingService {
  private repo = new PlatformBindingRepository()

  // ==================== 查询服务 ====================

  /**
   * 获取用户的所有平台绑定状态
   */
  async getUserBindings(userId: string): Promise<PlatformBindingResponse[]> {
    const bindings = await this.repo.findByUserId(userId)
    return bindings.map(b => ({
      id: b.id,
      platform: b.platform as BindingPlatform,
      platformUsername: b.platformUsername,
      bindingStatus: b.bindingStatus as PlatformBindingResponse['bindingStatus'],
      statusMessage: b.statusMessage,
      verifiedAt: b.verifiedAt
    }))
  }

  /**
   * 获取用户的单个平台绑定状态（快速检查）
   */
  async getUserPlatformBinding(userId: string, platform: BindingPlatform): Promise<{ bound: boolean; username?: string }> {
    const binding = await this.repo.findByUserAndPlatform(userId, platform)
    if (!binding || binding.bindingStatus !== 'bound') {
      return { bound: false }
    }
    return {
      bound: true,
      username: binding.platformUsername || undefined
    }
  }

  /**
   * 获取用户的所有平台绑定状态
   */
  getSupportedPlatforms(): PlatformConfig[] {
    return getSupportedPlatforms()
  }

  /**
   * 获取平台的配置 Schema
   * 前端根据 Schema 动态生成表单
   */
  getConfigSchema(platform: BindingPlatform): PlatformConfigSchema | null {
    switch (platform) {
      case 'luogu':
        return getLuoguConfigSchema()
      case 'vjudge':
        return getVJudgeConfigSchema()
      case 'codeforces':
        return getCodeforcesConfigSchema()
      default:
        return null
    }
  }

  // ==================== 绑定服务 ====================

  /**
   * 发起平台绑定
   */
  async bindPlatform(
    userId: string,
    platform: BindingPlatform,
    params: BindRequest
  ): Promise<BindResult> {
    const binder = getBinder(platform)

    // 如果该平台暂未实现绑定器
    if (!binder) {
      logger.warn('platform_binding_not_supported', {
        action: 'bind',
        userId,
        platform
      })
      return {
        success: false,
        message: '该平台绑定功能暂未开放，敬请期待'
      }
    }

    // 调用平台绑定器执行绑定
    try {
      const result = await binder.bind({
        username: params.platformUsername,
        password: params.password,
        extra: params.extra
      })

      if (result.success) {
        // 绑定成功，保存到数据库
        await this.repo.upsert({
          userId,
          platform,
          platformUsername: result.platformUsername || params.platformUsername,
          bindingStatus: 'bound',
          bindingData: result.bindingData,
          platformConfig: params.extra ? JSON.stringify(params.extra) : undefined,
          verifiedAt: new Date()
        })

        logger.audit('platform_binding_success', {
          userId,
          action: 'bind_platform',
          target: platform,
          metadata: { platformUsername: result.platformUsername }
        })

        return {
          success: true,
          message: '绑定成功',
          platformUsername: result.platformUsername
        }
      } else {
        // 绑定失败，记录状态
        await this.repo.upsert({
          userId,
          platform,
          platformUsername: params.platformUsername,
          bindingStatus: 'failed'
        })

        logger.warn('platform_binding_failed', {
          userId,
          action: 'bind_platform',
          target: platform,
          metadata: { message: result.message }
        })

        return {
          success: false,
          message: result.message || '绑定失败，请检查账号信息'
        }
      }
    } catch (error) {
      logger.error('platform_binding_error', error, {
        userId,
        action: 'bind_platform',
        target: platform
      })
      return {
        success: false,
        message: '绑定过程中发生错误，请稍后重试'
      }
    }
  }

  // ==================== 解绑服务 ====================

  /**
   * 解除平台绑定
   */
  async unbindPlatform(
    userId: string,
    platform: BindingPlatform
  ): Promise<UnbindResult> {
    const binding = await this.repo.findByUserAndPlatform(userId, platform)

    if (!binding) {
      return {
        success: false,
        message: '未找到绑定记录'
      }
    }

    // 调用平台绑定器的解绑方法（如果有的话）
    const binder = getBinder(platform)
    if (binder) {
      try {
        await binder.unbind(userId)
      } catch (error) {
        logger.error('platform_unbind_error', error, {
          userId,
          action: 'unbind_platform',
          target: platform
        })
        // 即使解绑失败，也继续删除本地记录
      }
    }

    // 重置绑定状态
    await this.repo.reset(userId, platform)

    logger.audit('platform_unbind_success', {
      userId,
      action: 'unbind_platform',
      target: platform
    })

    return {
      success: true,
      message: '解绑成功'
    }
  }

  // ==================== 刷新服务 ====================

  /**
   * 刷新绑定状态
   */
  async refreshBinding(
    userId: string,
    platform: BindingPlatform
  ): Promise<BindResult> {
    const binding = await this.repo.findByUserAndPlatform(userId, platform)

    if (!binding || binding.bindingStatus !== 'bound') {
      return {
        success: false,
        message: '未绑定或绑定状态异常'
      }
    }

    const binder = getBinder(platform)
    if (!binder) {
      return {
        success: false,
        message: '该平台暂不支持刷新'
      }
    }

    try {
      const result = await binder.refresh(userId)

      if (result.success) {
        logger.audit('platform_refresh_success', {
          userId,
          action: 'refresh_binding',
          target: platform
        })
        return {
          success: true,
          message: '刷新成功'
        }
      } else {
        return {
          success: false,
          message: result.message || '刷新失败'
        }
      }
    } catch (error) {
      logger.error('platform_refresh_error', error, {
        userId,
        action: 'refresh_binding',
        target: platform
      })
      return {
        success: false,
        message: '刷新过程中发生错误'
      }
    }
  }
}
