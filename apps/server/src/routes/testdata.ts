/**
 * 测试数据管理 API
 * 支持测试数据文件的上传、列表、删除
 */

import { Router } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'

export const testdataRouter = Router()

// 测试数据存储目录
const TESTDATA_DIR = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')

// 确保测试数据目录存在
if (!fs.existsSync(TESTDATA_DIR)) {
  fs.mkdirSync(TESTDATA_DIR, { recursive: true })
}

/**
 * 检查用户是否有权限管理测试数据
 * - 题目 owner 有权限
 * - super_admin / platform_admin 有权限
 */
async function canManageTestdata(userId: string, problemId: string): Promise<boolean> {
  const problem = await prisma.problem.findUnique({
    where: { id: problemId },
    select: { ownerId: true },
  })
  if (!problem) return false

  // owner 直接有权限
  if (problem.ownerId === userId) return true

  // 检查是否为管理员
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  })
  return user?.role === 'super_admin' || user?.role === 'platform_admin'
}

// 配置 multer 存储
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const problemId = req.params.id
    const problemDir = path.join(TESTDATA_DIR, problemId)
    if (!fs.existsSync(problemDir)) {
      fs.mkdirSync(problemDir, { recursive: true })
    }
    cb(null, problemDir)
  },
  filename: (_req, file, cb) => {
    // 保留原始文件名
    cb(null, file.originalname)
  }
})

const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB 限制
  }
})

/**
 * 计算文件 MD5
 */
function calculateMd5(filePath: string): string {
  const content = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(content).digest('hex')
}

/**
 * GET /api/problems/:id/testdata
 * 获取题目的测试数据文件列表
 */
testdataRouter.get('/problems/:id/testdata', authenticate, async (req: any, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    // 检查题目是否存在
    const problem = await prisma.problem.findUnique({
      where: { id }
    })

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: '题目不存在'
      })
    }

    // 权限检查：只有 owner 或管理员可查看测试数据
    if (!await canManageTestdata(userId, id)) {
      return res.status(403).json({
        success: false,
        message: '只有题目所有者或管理员可查看测试数据'
      })
    }

    // 获取测试数据文件列表
    const files = await prisma.testdataFile.findMany({
      where: { problemId: id },
      orderBy: { filename: 'asc' }
    })

    res.json({
      success: true,
      data: {
        files: files.map(f => ({
          id: f.id,
          filename: f.filename,
          size: f.size,
          md5: f.md5,
          uploadedAt: f.uploadedAt
        })),
        // 自动识别测试数据对
        pairs: autoDetectPairs(files.map(f => f.filename))
      }
    })
  } catch (e: any) {
    logger.error('get_testdata_error', {
      action: 'testdata',
      metadata: { error: e.message }
    })
    res.status(500).json({
      success: false,
      message: '获取测试数据失败'
    })
  }
})

/**
 * POST /api/problems/:id/testdata
 * 上传测试数据文件（支持多文件）
 */
testdataRouter.post(
  '/problems/:id/testdata',
  authenticate,
  (req: any, res, next) => {
    // Debug: 打印请求信息
    logger.info('testdata_upload_debug', {
      action: 'testdata',
      metadata: {
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length'],
        method: req.method,
        path: req.path
      }
    })
    next()
  },
  upload.array('files', 200),  // 增加到 200 个文件
  async (req: any, res) => {
    try {
      const { id } = req.params
      const files = req.files as Express.Multer.File[]

      if (!files || files.length === 0) {
        return res.status(400).json({
          success: false,
          message: '未选择文件'
        })
      }

      // 检查题目是否存在
      const problem = await prisma.problem.findUnique({
        where: { id }
      })

      if (!problem) {
        // 清理上传的文件
        files.forEach(f => fs.unlinkSync(f.path))
        return res.status(404).json({
          success: false,
          message: '题目不存在'
        })
      }

      // 权限检查：只有 owner 可以上传（ownerId 就是 userId）
      const userId = req.user.userId
      if (problem.ownerId !== userId) {
        // 清理上传的文件
        files.forEach(f => fs.unlinkSync(f.path))
        return res.status(403).json({
          success: false,
          message: '只有题目所有者可以上传测试数据'
        })
      }

      // 记录上传的文件
      const uploadedFiles = []
      for (const file of files) {
        const md5 = calculateMd5(file.path)

        // 检查是否已存在同名文件
        const existing = await prisma.testdataFile.findUnique({
          where: {
            problemId_filename: {
              problemId: id,
              filename: file.originalname
            }
          }
        })

        if (existing) {
          // 更新现有记录
          await prisma.testdataFile.update({
            where: { id: existing.id },
            data: {
              size: file.size,
              md5,
              uploadedAt: new Date()
            }
          })
          uploadedFiles.push({
            id: existing.id,
            filename: file.originalname,
            size: file.size,
            md5,
            status: 'updated'
          })
        } else {
          // 创建新记录
          const testdataFile = await prisma.testdataFile.create({
            data: {
              problemId: id,
              filename: file.originalname,
              size: file.size,
              md5
            }
          })
          uploadedFiles.push({
            id: testdataFile.id,
            filename: file.originalname,
            size: file.size,
            md5,
            status: 'created'
          })
        }
      }

      logger.info('testdata_uploaded', {
        action: 'testdata',
        metadata: {
          problemId: id,
          fileCount: files.length,
          files: files.map(f => f.originalname)
        }
      })

      res.json({
        success: true,
        data: {
          files: uploadedFiles,
          message: `成功上传 ${files.length} 个文件`
        }
      })
    } catch (e: any) {
      logger.error('upload_testdata_error', {
        action: 'testdata',
        metadata: { error: e.message }
      })
      res.status(500).json({
        success: false,
        message: '上传测试数据失败'
      })
    }
  }
)

/**
 * DELETE /api/problems/:id/testdata/:fileId
 * 删除测试数据文件
 */
testdataRouter.delete('/problems/:id/testdata/:fileId', authenticate, async (req: any, res) => {
  try {
    const { id, fileId } = req.params

    // 检查题目是否存在
    const problem = await prisma.problem.findUnique({
      where: { id }
    })

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: '题目不存在'
      })
    }

    // 权限检查：只有 owner 可以删除（ownerId 就是 userId）
    const userId = req.user.userId
    if (problem.ownerId !== userId) {
      return res.status(403).json({
        success: false,
        message: '只有题目所有者可以删除测试数据'
      })
    }

    // 获取文件记录
    const testdataFile = await prisma.testdataFile.findUnique({
      where: { id: fileId }
    })

    if (!testdataFile || testdataFile.problemId !== id) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      })
    }

    // 删除物理文件
    const filePath = path.join(TESTDATA_DIR, id, testdataFile.filename)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除数据库记录
    await prisma.testdataFile.delete({
      where: { id: fileId }
    })

    logger.info('testdata_deleted', {
      action: 'testdata',
      metadata: { problemId: id, filename: testdataFile.filename }
    })

    res.json({
      success: true,
      message: '文件已删除'
    })
  } catch (e: any) {
    logger.error('delete_testdata_error', {
      action: 'testdata',
      metadata: { error: e.message }
    })
    res.status(500).json({
      success: false,
      message: '删除测试数据失败'
    })
  }
})

/**
 * POST /api/problems/:id/testdata/auto
 * 自动识别测试数据对
 */
testdataRouter.post('/problems/:id/testdata/auto', authenticate, async (req: any, res) => {
  try {
    const { id } = req.params
    const userId = req.user.userId

    // 检查题目是否存在
    const problem = await prisma.problem.findUnique({
      where: { id }
    })

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: '题目不存在'
      })
    }

    // 权限检查：只有 owner 或管理员可查看测试数据
    if (!await canManageTestdata(userId, id)) {
      return res.status(403).json({
        success: false,
        message: '只有题目所有者或管理员可查看测试数据'
      })
    }

    // 获取所有测试数据文件
    const files = await prisma.testdataFile.findMany({
      where: { problemId: id },
      orderBy: { filename: 'asc' }
    })

    const filenames = files.map(f => f.filename)
    const pairs = autoDetectPairs(filenames)

    res.json({
      success: true,
      data: {
        pairs,
        unmatched: findUnmatchedFiles(filenames, pairs)
      }
    })
  } catch (e: any) {
    logger.error('auto_detect_pairs_error', {
      action: 'testdata',
      metadata: { error: e.message }
    })
    res.status(500).json({
      success: false,
      message: '自动识别失败'
    })
  }
})

/**
 * GET /api/problems/:id/testdata/download/:filename
 * 下载测试数据文件
 */
testdataRouter.get('/problems/:id/testdata/download/:filename', authenticate, async (req: any, res) => {
  try {
    const { id, filename } = req.params
    const userId = req.user.userId

    // 安全检查：防止路径穿越
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      return res.status(400).json({
        success: false,
        message: '非法文件名'
      })
    }

    // 检查文件记录是否存在
    const testdataFile = await prisma.testdataFile.findUnique({
      where: {
        problemId_filename: {
          problemId: id,
          filename
        }
      }
    })

    if (!testdataFile) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      })
    }

    // 权限检查：只有 owner 或管理员可下载测试数据
    if (!await canManageTestdata(userId, id)) {
      return res.status(403).json({
        success: false,
        message: '只有题目所有者或管理员可下载测试数据'
      })
    }

    const filePath = path.join(TESTDATA_DIR, id, filename)

    // 二次校验：确保解析后的路径在预期目录内
    const resolvedPath = path.resolve(filePath)
    const expectedDir = path.resolve(TESTDATA_DIR, id)
    if (!resolvedPath.startsWith(expectedDir)) {
      return res.status(400).json({
        success: false,
        message: '非法路径'
      })
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: '文件不存在'
      })
    }

    res.download(filePath, filename)
  } catch (e: any) {
    logger.error('download_testdata_error', {
      action: 'testdata',
      metadata: { error: e.message }
    })
    res.status(500).json({
      success: false,
      message: '下载失败'
    })
  }
})

/**
 * 自动识别测试数据对
 * 匹配规则：相同名称的 .in 和 .out/.ans 文件
 */
function autoDetectPairs(filenames: string[]): Array<{ input: string; output: string }> {
  const pairs: Array<{ input: string; output: string }> = []
  const inputFiles = filenames.filter(f => f.endsWith('.in'))
  const outputFiles = filenames.filter(f => f.endsWith('.out') || f.endsWith('.ans'))

  for (const inputFile of inputFiles) {
    const baseName = inputFile.slice(0, -3) // 去掉 .in
    // 优先匹配 .out，其次 .ans
    const outputFile = outputFiles.find(f => f === `${baseName}.out`) ||
                       outputFiles.find(f => f === `${baseName}.ans`)

    if (outputFile) {
      pairs.push({ input: inputFile, output: outputFile })
    }
  }

  return pairs
}

/**
 * 找出未匹配的文件
 */
function findUnmatchedFiles(filenames: string[], pairs: Array<{ input: string; output: string }>): string[] {
  const matched = new Set<string>()
  for (const pair of pairs) {
    matched.add(pair.input)
    matched.add(pair.output)
  }
  return filenames.filter(f => !matched.has(f))
}