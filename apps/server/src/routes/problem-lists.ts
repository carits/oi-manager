/**
 * 题单管理 API
 * @description 飞书文档式权限的题单管理系统
 * 3 级结构：题单 (ProblemList) → 章节 (Section) → 题目条目 (Entry)
 * UI 层面：所有章节和题目渲染在同一个页面上，章节仅作二级标题分组
 */

import { Router, type Response } from 'express'
import { authenticate } from '../middleware/auth'
import logger from '../lib/logger'
import { asyncHandler } from '../lib/asyncHandler'
import { parsePagination } from '../lib/pagination'
import {
  downloadProblemListEntryFile,
  getProblemListEntryStatement,
} from '../modules/problem-list/application/problem-list-content.service'
import {
  createProblemList,
  deleteProblemList,
  getProblemListDetail,
  listProblemLists,
  ProblemListApplicationError,
  updateProblemList,
} from '../modules/problem-list/application/problem-list-crud.service'
import {
  addProblemListSection,
  deleteProblemListSection,
  reorderProblemListSections,
  updateProblemListSection,
} from '../modules/problem-list/application/problem-list-section.service'
import {
  addProblemListEntry,
  deleteProblemListEntry,
  reorderProblemListEntries,
  resolveProblemListEntries,
  updateProblemListEntry,
} from '../modules/problem-list/application/problem-list-entry.service'
import {
  deleteProblemListShare,
  listProblemListShareCandidates,
  listProblemListShares,
  upsertProblemListShare,
} from '../modules/problem-list/application/problem-list-share.service'
import { createAssignmentFromProblemList } from '../modules/problem-list/application/problem-list-homework.service'
import type { AuthRequest } from '../middleware/auth'
import { ProblemListContracts } from '@oi-manager/contracts'
import { parseContractBody, parseContractQuery, sendContractData } from '../lib/api-contract'

export const problemListsRouter = Router()

function problemListEndpoint(label: string, handler: (req: AuthRequest, res: Response) => Promise<unknown>) {
  return asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      await handler(req, res)
    } catch (error) {
      if (error instanceof ProblemListApplicationError) {
        return res.status(error.statusCode).json({
          success: false,
          ...(error.code ? { code: error.code } : {}),
          ...(error.data !== undefined ? { data: error.data } : {}),
          message: error.message,
        })
      }
      throw error
    }
  }, label)
}

// ==================== 题单 CRUD ====================

/**
 * GET /api/problem-lists
 * 获取题单列表（我的 + 共享给我的）
 */
problemListsRouter.get('/', authenticate, problemListEndpoint('获取题单列表失败', async (req, res) => {
  const query = parseContractQuery(ProblemListContracts.list, req.query)
  const { page, pageSize, skip } = parsePagination(query)
  sendContractData(res, ProblemListContracts.list, await listProblemLists(req.user!, query, page, pageSize, skip))
}))

/**
 * POST /api/problem-lists
 * 创建题单（同时创建一个默认章节）
 */
problemListsRouter.post('/', authenticate, problemListEndpoint('创建题单失败', async (req, res) => {
  const body = parseContractBody(ProblemListContracts.create, req.body)
  sendContractData(res, ProblemListContracts.create, await createProblemList(req.user!, body), 201)
}))

/**
 * GET /api/problem-lists/:id
 * 题单详情（含章节 → 题目条目）
 */
problemListsRouter.get('/:id', authenticate, problemListEndpoint('获取题单详情失败', async (req, res) => {
  res.json({ success: true, data: await getProblemListDetail(req.user!, req.params.id) })
}))

/**
 * GET /api/problem-lists/:id/entries/:entryId/problem
 * Read a published statement through an authorized problem-list context.
 */
problemListsRouter.get('/:id/entries/:entryId/problem', authenticate, problemListEndpoint('获取题单题面失败', async (req, res) => {
  res.json({ success: true, data: await getProblemListEntryStatement(req.user!, req.params.id, req.params.entryId) })
}))

/**
 * GET /api/problem-lists/:id/entries/:entryId/files/:fileId
 * Download only a file referenced by the authorized statement or attachment.
 */
problemListsRouter.get('/:id/entries/:entryId/files/:fileId', authenticate, problemListEndpoint('下载题单题目资源失败', async (req, res) => {
  const download = await downloadProblemListEntryFile(req.user!, req.params.id, req.params.entryId, req.params.fileId)
  res.setHeader('Content-Type', download.mimeType)
  res.setHeader('Content-Disposition', `${download.disposition}; filename*=UTF-8''${encodeURIComponent(download.originalName)}`)
  res.setHeader('Content-Length', download.buffer.length)
  res.setHeader('Cache-Control', 'private, no-store')
  res.send(download.buffer)
}))

/**
 * PUT /api/problem-lists/:id
 * 更新题单元信息
 */
problemListsRouter.put('/:id', authenticate, problemListEndpoint('更新题单失败', async (req, res) => {
  res.json({ success: true, data: await updateProblemList(req.user!, req.params.id, req.body) })
}))

/**
 * DELETE /api/problem-lists/:id
 * 硬删除题单（级联删除章节→条目→分享）
 */
problemListsRouter.delete('/:id', authenticate, problemListEndpoint('删除题单失败', async (req, res) => {
  parseContractBody(ProblemListContracts.delete, req.body || {})
  await deleteProblemList(req.user!, req.params.id)
  sendContractData(res, ProblemListContracts.delete, {})
}))

// ==================== 章节 CRUD ====================

/**
 * POST /api/problem-lists/:id/sections
 * 添加章节
 */
problemListsRouter.post('/:id/sections', authenticate, problemListEndpoint('添加章节失败', async (req, res) => {
  res.json({ success: true, data: await addProblemListSection(req.user!, req.params.id, req.body) })
}))

/**
 * PUT /api/problem-lists/sections/:sectionId
 * 更新章节（标题 / sortOrder）
 */
problemListsRouter.put('/sections/:sectionId', authenticate, problemListEndpoint('更新章节失败', async (req, res) => {
  res.json({ success: true, data: await updateProblemListSection(req.user!, req.params.sectionId, req.body) })
}))

/**
 * DELETE /api/problem-lists/sections/:sectionId
 * 删除章节（级联删除其下所有条目）
 */
problemListsRouter.delete('/sections/:sectionId', authenticate, problemListEndpoint('删除章节失败', async (req, res) => {
  await deleteProblemListSection(req.user!, req.params.sectionId)
  res.json({ success: true, message: '删除成功' })
}))

/**
 * PUT /api/problem-lists/:id/sections/reorder
 * 重排章节顺序
 */
problemListsRouter.put('/:id/sections/reorder', authenticate, problemListEndpoint('排序失败', async (req, res) => {
  await reorderProblemListSections(req.user!, req.params.id, req.body.sectionIds)
  res.json({ success: true })
}))

// ==================== 题目条目 CRUD ====================

/**
 * POST /api/problem-lists/sections/:sectionId/entries/single
 * 单条添加题目到指定章节（VJudge 逐行输入）
 */
problemListsRouter.post('/sections/:sectionId/entries/single', authenticate, problemListEndpoint('添加题目失败', async (req, res) => {
  res.json({ success: true, data: await addProblemListEntry(req.user!, req.params.sectionId, req.body) })
}))

/**
 * POST /api/problem-lists/:id/entries/resolve
 * 批量解析题号 → 查找/创建 Problem 记录（不创建 Entry，仅预览）
 */
problemListsRouter.post('/:id/entries/resolve', authenticate, problemListEndpoint('解析题号失败', async (req, res) => {
  res.json({ success: true, data: await resolveProblemListEntries(req.user!, req.params.id, req.body.items) })
}))

/**
 * PUT /api/problem-lists/entries/:entryId
 * 更新条目（alias / notes / sortOrder）
 */
problemListsRouter.put('/entries/:entryId', authenticate, problemListEndpoint('更新条目失败', async (req, res) => {
  res.json({ success: true, data: await updateProblemListEntry(req.user!, req.params.entryId, req.body) })
}))
problemListsRouter.delete('/entries/:entryId', authenticate, problemListEndpoint('删除条目失败', async (req, res) => {
  await deleteProblemListEntry(req.user!, req.params.entryId)
  res.json({ success: true, message: '删除成功' })
}))

/**
 * PUT /api/problem-lists/sections/:sectionId/entries/reorder
 * 重排某章节内的条目顺序
 */
problemListsRouter.put('/sections/:sectionId/entries/reorder', authenticate, problemListEndpoint('排序失败', async (req, res) => {
  await reorderProblemListEntries(req.user!, req.params.sectionId, req.body.entryIds)
  res.json({ success: true })
}))


/**
 * GET /api/problem-lists/:id/shares
 * 获取题单分享列表
 */
problemListsRouter.get('/:id/shares', authenticate, problemListEndpoint('获取分享列表失败', async (req, res) => {
  res.json({ success: true, data: await listProblemListShares(req.user!, req.params.id) })
}))

/**
 * GET /api/problem-lists/:id/share-candidates
 * 搜索本校可分享的教师/学生
 */
problemListsRouter.get('/:id/share-candidates', authenticate, problemListEndpoint('搜索失败', async (req, res) => {
  res.json({ success: true, data: await listProblemListShareCandidates(req.user!, req.params.id, req.query) })
}))

/**
 * POST /api/problem-lists/:id/shares
 * 添加/更新分享
 */
problemListsRouter.post('/:id/shares', authenticate, problemListEndpoint('添加分享失败', async (req, res) => {
  res.json({ success: true, data: await upsertProblemListShare(req.user!, req.params.id, req.body) })
}))

/**
 * DELETE /api/problem-lists/:id/shares/:shareId
 * 移除分享
 */
problemListsRouter.delete('/:id/shares/:shareId', authenticate, problemListEndpoint('移除分享失败', async (req, res) => {
  await deleteProblemListShare(req.user!, req.params.id, req.params.shareId)
  res.json({ success: true, message: '移除成功' })
}))

/**
 * POST /api/problem-lists/:id/create-assignment
 * 从题单创建独立作业草稿（平铺条目并固定当前 TestSet Revision）
 */
problemListsRouter.post('/:id/create-assignment', authenticate, problemListEndpoint('创建作业草稿失败', async (req, res) => {
  res.status(201).json({ success: true, data: await createAssignmentFromProblemList(req.user!, req.params.id, req.body) })
}))

problemListsRouter.post('/:id/publish-homework', authenticate, (_req, res) => {
  res.status(410).json({ success: false, code: 'LEGACY_HOMEWORK_API_RETIRED', message: '旧作业发布接口已退役，请创建独立 Assignment 草稿' })
})
