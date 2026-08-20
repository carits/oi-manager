/**
 * Problem Judge Config Routes
 * 评测配置路由
 */

import { Router } from 'express'
import { prisma } from '../../prisma'
import { authenticate } from '../../middleware/auth'
import { asyncHandler } from '../../lib/asyncHandler'
import { canModifyProblem } from './problem.access'
import logger from '../../lib/logger'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

export const problemJudgeRouter = Router()

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
const checkerUpload = multer({ dest: path.join(TESTDATA_ROOT, 'tmp-checkers'), limits: { fileSize: 2 * 1024 * 1024 } })
const checkerExtensions = new Set(['.cpp', '.cc', '.cxx'])

function checkerDirectory(problemId: string): string {
  const root = path.resolve(TESTDATA_ROOT)
  const directory = path.resolve(root, problemId)
  if (directory !== root && !directory.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid checker directory')
  }
  return directory
}

async function getCheckerProblem(id: string, user: any) {
  const problem = await prisma.problem.findUnique({ where: { id } })
  if (!problem || !canModifyProblem(user, problem)) return null
  return problem
}

problemJudgeRouter.get('/:id/checker', authenticate, asyncHandler(async (req, res) => {
  const problem = await getCheckerProblem(req.params.id, (req as any).user)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const files = await prisma.problemChecker.findMany({ where: { problemId: problem.id }, orderBy: { uploadedAt: 'asc' } })
  res.json({ success: true, data: files })
}))

problemJudgeRouter.get('/:id/checker/:fileName/download', authenticate, asyncHandler(async (req, res) => {
  const problem = await getCheckerProblem(req.params.id, (req as any).user)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const fileName = path.basename(req.params.fileName)
  const file = await prisma.problemChecker.findFirst({ where: { problemId: problem.id, fileName } })
  if (!file) return res.status(404).json({ success: false, message: '文件不存在' })
  const target = path.join(checkerDirectory(problem.id), fileName)
  if (!fs.existsSync(target)) return res.status(404).json({ success: false, message: '文件不存在' })
  res.download(target, fileName)
}))

problemJudgeRouter.post('/:id/checker', authenticate, checkerUpload.single('file'), asyncHandler(async (req, res) => {
  const problem = await getCheckerProblem(req.params.id, (req as any).user)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const upload = req.file
  if (!upload) return res.status(400).json({ success: false, message: '请选择文件' })
  const fileName = path.basename(upload.originalname)
  if (!checkerExtensions.has(path.extname(fileName).toLowerCase())) {
    fs.rmSync(upload.path, { force: true })
    return res.status(400).json({ success: false, message: 'Checker only supports .cpp, .cc, and .cxx source files; testlib.h is provided by the system' })
  }
  const dir = checkerDirectory(problem.id)
  fs.mkdirSync(dir, { recursive: true })
  const target = path.join(dir, fileName)
  fs.renameSync(upload.path, target)
  const downloadUrl = `/api/problems/${encodeURIComponent(problem.id)}/checker/${encodeURIComponent(fileName)}/download`
  const file = await prisma.problemChecker.upsert({ where: { problemId_fileName: { problemId: problem.id, fileName } }, update: { fileSize: upload.size, fileUrl: downloadUrl, language: path.extname(fileName).slice(1) }, create: { id: crypto.randomUUID(), problemId: problem.id, fileName, fileSize: upload.size, fileUrl: downloadUrl, language: path.extname(fileName).slice(1) } })
  res.json({ success: true, data: file })
}))

problemJudgeRouter.delete('/:id/checker/:checkerId', authenticate, asyncHandler(async (req, res) => {
  const problem = await getCheckerProblem(req.params.id, (req as any).user)
  if (!problem) return res.status(404).json({ success: false, message: '题目不存在' })
  const file = await prisma.problemChecker.findFirst({ where: { id: req.params.checkerId, problemId: problem.id } })
  if (!file) return res.status(404).json({ success: false, message: '文件不存在' })
  await prisma.problemChecker.delete({ where: { id: file.id } })
  fs.rmSync(path.join(checkerDirectory(problem.id), file.fileName), { force: true })
  res.json({ success: true })
}))

/**
 * GET /api/problems/:id/judge-config
 * 获取题目的评测配置
 */
problemJudgeRouter.get('/:id/judge-config', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const user = (req as any).user

    const problem = await prisma.problem.findUnique({ where: { id } })

    if (!problem || !canModifyProblem(user, problem)) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    // 解析 YAML 配置
    let config = null
    if (problem.judgeConfig) {
      try {
        const yaml = await import('js-yaml')
        config = yaml.load(problem.judgeConfig)
        logger.info('judge_config_loaded', { action: 'getJudgeConfig', metadata: { subtasksCount: (config as any)?.subtasks?.length ?? 0 } })
      } catch (e) {
        logger.warn('parse_judge_config_error', { error: e })
      }
    }

    res.json({
      success: true,
      data: {
        problemType: problem.problemType,
        timeLimit: problem.timeLimit,
        memoryLimit: problem.memoryLimit,
        config
      }
    })
}))

/**
 * PUT /api/problems/:id/judge-config
 * 保存题目的评测配置
 */
problemJudgeRouter.put('/:id/judge-config', authenticate, asyncHandler(async (req, res) => {
    const { id } = req.params
    const user = (req as any).user
    const { problemType, timeLimit, memoryLimit, config } = req.body

    const existingProblem = await prisma.problem.findUnique({ where: { id } })

    if (!existingProblem || !canModifyProblem(user, existingProblem)) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    let judgeConfigYaml = null
    if (config) {
      const mode = config.mode || (Array.isArray(config.subtasks) && config.subtasks.length > 0 ? 'oi' : 'acm')
      if (mode !== 'acm' && mode !== 'oi') return res.status(400).json({ success: false, message: '无效的评测模式，必须是 acm 或 oi' })
      const checkerType = String(config.checker_type || 'default').toLowerCase()
      if (mode === 'acm' && checkerType === 'lemon') {
        return res.status(400).json({ success: false, message: 'ACM 赛制不支持 Lemon checker，请使用 testlib 或其他判定型 checker' })
      }
      const yaml = await import('js-yaml')
      const normalized = { ...config, mode }
      judgeConfigYaml = yaml.dump(normalized, { lineWidth: -1 })
      logger.info('judge_config_saving', { action: 'saveJudgeConfig', metadata: { mode, subtasksCount: normalized.subtasks?.length ?? 0 } })
    }

    const updateData: any = {}
    if (problemType) updateData.problemType = problemType
    if (timeLimit !== undefined) updateData.timeLimit = timeLimit
    if (memoryLimit !== undefined) updateData.memoryLimit = memoryLimit
    updateData.judgeConfig = judgeConfigYaml

    const problem = await prisma.problem.update({
      where: { id },
      data: updateData
    })

    logger.audit('judge_config_updated', {
      userId: user.userId,
      action: 'update_judge_config',
      target: id,
      metadata: { problemType, timeLimit, memoryLimit }
    })

    res.json({ success: true, data: problem })
}))
