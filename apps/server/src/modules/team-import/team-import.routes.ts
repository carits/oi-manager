/**
 * 团队导入模块 - 路由层
 */

import { Router, Request, Response } from 'express'
import { authenticate } from '../../middleware/auth'
import { TeamImportService } from './team-import.service'
import { vjudgeImportService } from './vjudge-import.service'
import { luoguImportService } from './luogu-import.service'
import { memberMatchService } from './member-match.service'
import type { ImportPlatform } from './team-import.types'

export const teamImportRouter = Router()
const service = new TeamImportService()

// ==================== VJudge 导入相关路由 ====================

/**
 * 获取 VJudge 团队列表
 * GET /api/team-import/vjudge/groups
 */
teamImportRouter.get('/vjudge/groups', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      })
    }

    const groups = await vjudgeImportService.getGroups(user.userId)

    res.json({
      success: true,
      data: groups
    })
  } catch (err) {
    console.error('[TeamImport] VJudge groups error:', err)
    const errMsg = err instanceof Error ? err.message : '获取团队列表失败'
    // Cloudflare 拦截返回 400 让前端能区分
    if (errMsg.includes('CLOUDFLARE_BLOCKED') || errMsg.includes('Cloudflare') || errMsg.includes('人机验证')) {
      res.status(400).json({
        success: false,
        message: 'VJudge Cookie 已被 Cloudflare 人机验证拦截，请在平台绑定页面重新获取 Cookie 后再试',
        errorType: 'CLOUDFLARE_BLOCKED'
      })
    } else {
      res.status(500).json({
        success: false,
        message: errMsg
      })
    }
  }
})

/**
 * 预览 VJudge 团队
 * POST /api/team-import/vjudge/preview
 */
teamImportRouter.post('/vjudge/preview', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '未登录'
      })
    }

    const { shortName, includeAnnouncement, includeDescription, includeMembers } = req.body

    if (!shortName) {
      return res.status(400).json({
        success: false,
        message: '缺少团队标识'
      })
    }

    const schoolId = user.schoolId
    if (!schoolId) {
      return res.status(400).json({
        success: false,
        message: '用户未关联学校'
      })
    }

    const preview = await vjudgeImportService.previewGroup(
      user.userId,
      shortName,
      {
        includeAnnouncement: includeAnnouncement !== false,
        includeDescription: includeDescription !== false,
        includeMembers: includeMembers !== false
      }
    )

    res.json({
      success: true,
      data: preview
    })
  } catch (err) {
    console.error('[TeamImport] VJudge preview error:', err)
    const errMsg = err instanceof Error ? err.message : '预览团队失败'
    if (errMsg.includes('CLOUDFLARE_BLOCKED') || errMsg.includes('Cloudflare') || errMsg.includes('人机验证')) {
      res.status(400).json({
        success: false,
        message: 'VJudge Cookie 已被 Cloudflare 人机验证拦截，请在平台绑定页面重新获取 Cookie 后再试',
        errorType: 'CLOUDFLARE_BLOCKED'
      })
    } else {
      res.status(500).json({
        success: false,
        message: errMsg
      })
    }
  }
})

/**
 * 校验 VJudge 导入成员冲突
 * POST /api/team-import/vjudge/validate
 */
teamImportRouter.post('/vjudge/validate', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || (user.role !== 'teacher' && user.role !== 'school_principal')) {
      return res.status(403).json({ success: false, message: '只有教师可以使用此功能' })
    }

    const { members } = req.body
    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ success: false, message: '缺少成员列表' })
    }

    const schoolId = user.schoolId
    if (!schoolId) {
      return res.status(400).json({ success: false, message: '用户未关联学校' })
    }

    const results = await vjudgeImportService.validateMembers(schoolId, members)

    res.json({ success: true, data: results })
  } catch (err) {
    console.error('[TeamImport] VJudge validate error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '校验失败'
    })
  }
})

/**
 * 执行 VJudge 导入
 * POST /api/team-import/vjudge/import
 */
teamImportRouter.post('/vjudge/import', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || (user.role !== 'teacher' && user.role !== 'school_principal')) {
      return res.status(403).json({
        success: false,
        message: '只有教师可以使用此功能'
      })
    }

    const { teamId, createTeam, visibility, teamName, vjudgeGroupId, members, announcement, description, avatarUrl } = req.body

    if (!members || !Array.isArray(members)) {
      return res.status(400).json({
        success: false,
        message: '缺少成员列表'
      })
    }

    // createTeam 参数由前端传入，不再需要验证

    const teacherId = user.userId
    const schoolId = user.schoolId

    if (!teacherId || !schoolId) {
      return res.status(400).json({
        success: false,
        message: '教师信息不完整'
      })
    }

    const result = await vjudgeImportService.importMembers(
      user.userId,
      teacherId,
      schoolId,
      { teamId, createTeam, visibility, teamName, vjudgeGroupId, members, announcement, description, avatarUrl },
      user
    )

    res.json({
      success: true,
      data: result
    })
  } catch (err) {
    console.error('[TeamImport] VJudge import error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '导入失败'
    })
  }
})

// ==================== 洛谷导入相关路由 ====================

/**
 * 获取洛谷团队列表
 * GET /api/team-import/luogu/groups
 */
teamImportRouter.get('/luogu/groups', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' })
    }

    const groups = await luoguImportService.getGroups(user.userId)

    res.json({ success: true, data: groups })
  } catch (err) {
    console.error('[TeamImport] Luogu groups error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '获取团队列表失败'
    })
  }
})

/**
 * 预览洛谷团队
 * POST /api/team-import/luogu/preview
 */
teamImportRouter.post('/luogu/preview', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({ success: false, message: '未登录' })
    }

    const { teamId, includeAnnouncement, includeMembers } = req.body

    if (!teamId) {
      return res.status(400).json({ success: false, message: '缺少团队ID' })
    }

    const preview = await luoguImportService.previewGroup(
      user.userId,
      teamId,
      {
        includeAnnouncement: includeAnnouncement !== false,
        includeMembers: includeMembers !== false,
      }
    )

    res.json({ success: true, data: preview })
  } catch (err) {
    console.error('[TeamImport] Luogu preview error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '预览团队失败'
    })
  }
})

/**
 * 校验洛谷导入成员冲突
 * POST /api/team-import/luogu/validate
 */
teamImportRouter.post('/luogu/validate', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || (user.role !== 'teacher' && user.role !== 'school_principal')) {
      return res.status(403).json({ success: false, message: '只有教师可以使用此功能' })
    }

    const { members } = req.body
    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ success: false, message: '缺少成员列表' })
    }

    const schoolId = user.schoolId
    if (!schoolId) {
      return res.status(400).json({ success: false, message: '用户未关联学校' })
    }

    const results = await memberMatchService.checkConflicts(schoolId, members)

    res.json({ success: true, data: results })
  } catch (err) {
    console.error('[TeamImport] Luogu validate error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '校验失败'
    })
  }
})

/**
 * 执行洛谷导入
 * POST /api/team-import/luogu/import
 */
teamImportRouter.post('/luogu/import', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || (user.role !== 'teacher' && user.role !== 'school_principal')) {
      return res.status(403).json({ success: false, message: '只有教师可以使用此功能' })
    }

    const { teamId, createTeam, visibility, teamName, luoguTeamId, announcement, members } = req.body

    if (!members || !Array.isArray(members)) {
      return res.status(400).json({ success: false, message: '缺少成员列表' })
    }

    const teacherId = user.userId
    const schoolId = user.schoolId

    if (!teacherId || !schoolId) {
      return res.status(400).json({ success: false, message: '教师信息不完整' })
    }

    const result = await luoguImportService.importMembers(
      user.userId,
      teacherId,
      schoolId,
      { teamId, createTeam, visibility, teamName, luoguTeamId, announcement, members },
      user
    )

    res.json({ success: true, data: result })
  } catch (err) {
    console.error('[TeamImport] Luogu import error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '导入失败'
    })
  }
})

// ==================== 原有路由 ====================

/**
 * 获取用户管理的团队列表
 * GET /api/team-import/teams
 */
teamImportRouter.get('/teams', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || (user.role !== 'teacher' && user.role !== 'school_principal')) {
      return res.status(403).json({
        success: false,
        message: '只有教师可以使用此功能',
      })
    }

    // 获取教师 ID
    const teacherId = user.userId
    if (!teacherId) {
      return res.status(400).json({
        success: false,
        message: '教师信息不完整',
      })
    }

    const teams = await service.getUserTeams(teacherId)

    res.json({
      success: true,
      data: teams,
    })
  } catch (err) {
    console.error('[TeamImport] Get teams error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '获取团队列表失败',
    })
  }
})

/**
 * 获取可导入的平台列表
 * GET /api/team-import/platforms
 */
teamImportRouter.get('/platforms', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user) {
      return res.status(401).json({
        success: false,
        message: '未登录',
      })
    }

    const platforms = await service.getAvailablePlatforms(user.userId)

    res.json({
      success: true,
      data: { platforms },
    })
  } catch (err) {
    console.error('[TeamImport] Get platforms error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '获取平台列表失败',
    })
  }
})

/**
 * 开始导入
 * POST /api/team-import/start
 */
teamImportRouter.post('/start', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || (user.role !== 'teacher' && user.role !== 'school_principal')) {
      return res.status(403).json({
        success: false,
        message: '只有教师可以使用此功能',
      })
    }

    const { platform, visibility, rawData, teamName, createTeam } = req.body

    if (!platform || !rawData) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    const teacherId = user.userId
    const schoolId = user.schoolId
    if (!teacherId || !schoolId) {
      return res.status(400).json({
        success: false,
        message: '教师信息不完整',
      })
    }

    // 转换 createTeam 为 'yes' 或 'no'
    let createTeamValue: 'yes' | 'no' = 'yes'
    if (createTeam === false || createTeam === 'no') {
      createTeamValue = 'no'
    }

    const result = await service.createBatch({
      operatorId: teacherId,
      schoolId,
      platform: platform as ImportPlatform,
      createTeam: createTeamValue,
      visibility: visibility || 'public',
      teamName,
      rawData,
      user,
    })

    res.json({
      success: true,
      data: result,
    })
  } catch (err) {
    console.error('[TeamImport] Start import error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '创建导入批次失败',
    })
  }
})

/**
 * 获取预览数据
 * GET /api/team-import/:batchId/preview
 */
teamImportRouter.get('/:batchId/preview', authenticate, async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: '缺少批次 ID',
      })
    }

    const preview = await service.previewBatch(batchId)

    res.json({
      success: true,
      data: preview,
    })
  } catch (err) {
    console.error('[TeamImport] Preview error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '获取预览数据失败',
    })
  }
})

/**
 * 确认导入
 * POST /api/team-import/:batchId/confirm
 */
teamImportRouter.post('/:batchId/confirm', authenticate, async (req: Request, res: Response) => {
  try {
    const user = req.user
    if (!user || (user.role !== 'teacher' && user.role !== 'school_principal')) {
      return res.status(403).json({
        success: false,
        message: '只有教师可以使用此功能',
      })
    }

    const { batchId } = req.params
    const { items } = req.body

    if (!batchId || !items) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    const teacherId = user.userId
    if (!teacherId) {
      return res.status(400).json({
        success: false,
        message: '教师信息不完整',
      })
    }

    const result = await service.confirmImport(
      {
        batchId,
        items,
      },
      teacherId,
      user
    )

    res.json({
      success: true,
      data: result,
    })
  } catch (err) {
    console.error('[TeamImport] Confirm error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '确认导入失败',
    })
  }
})

/**
 * 获取导入结果
 * GET /api/team-import/:batchId/result
 */
teamImportRouter.get('/:batchId/result', authenticate, async (req: Request, res: Response) => {
  try {
    const { batchId } = req.params

    if (!batchId) {
      return res.status(400).json({
        success: false,
        message: '缺少批次 ID',
      })
    }

    const result = await service.getImportResult(batchId)

    res.json({
      success: true,
      data: result,
    })
  } catch (err) {
    console.error('[TeamImport] Get result error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '获取导入结果失败',
    })
  }
})

/**
 * 获取团队导入历史
 * GET /api/team-import/history/:teamId
 */
teamImportRouter.get('/history/:teamId', authenticate, async (req: Request, res: Response) => {
  try {
    const { teamId } = req.params

    if (!teamId) {
      return res.status(400).json({
        success: false,
        message: '缺少团队 ID',
      })
    }

    const history = await service.getImportHistory(teamId)

    res.json({
      success: true,
      data: history,
    })
  } catch (err) {
    console.error('[TeamImport] Get history error:', err)
    res.status(500).json({
      success: false,
      message: err instanceof Error ? err.message : '获取导入历史失败',
    })
  }
})