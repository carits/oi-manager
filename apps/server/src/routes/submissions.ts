/**
 * 评测记录 API（骨架）
 * @description 当前返回空数组，后续接入实际评测数据
 */

import { Router } from 'express'
import { authenticate } from '../middleware/auth'

export const submissionsRouter = Router()

/**
 * GET /api/submissions
 * 获取评测记录列表
 * @query username - 用户名筛选
 * @query oj - OJ 平台筛选
 * @query problemId - 题号筛选
 * @query result - 评测结果筛选
 * @query language - 编程语言筛选
 * @query page - 页码（默认 1）
 * @query pageSize - 每页条数（默认 20）
 */
submissionsRouter.get('/', authenticate, async (req, res) => {
  // 后续接入实际评测数据时实现筛选逻辑
  // const { username, oj, problemId, result, language, page = 1, pageSize = 20 } = req.query

  res.json({
    success: true,
    data: {
      submissions: [],
      page: 1,
      totalPages: 0,
      total: 0,
    },
  })
})
