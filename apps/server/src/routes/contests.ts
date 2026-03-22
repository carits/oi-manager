import { Router, Response } from 'express'
import { prisma } from '../prisma'
import { authenticate, authorize, isAdmin, AuthRequest } from '../middleware/auth'
import multer from 'multer'
import path from 'path'
import fs from 'fs'

// 配置上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }
    cb(null, uploadDir)
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    cb(null, uniqueSuffix + path.extname(file.originalname))
  }
})

const upload = multer({ storage })

export const contestRouter = Router()

// 获取比赛列表
contestRouter.get('/', authenticate, async (req, res) => {
  try {
    const { status, type, teamId, scope, page = '1', pageSize = '20' } = req.query

    const where: Record<string, unknown> = {}
    if (status) where.status = status as string
    if (type) where.type = type as string // training / official / mock
    if (teamId) where.teamId = teamId as string
    if (scope) where.scope = scope as string // public / team

    const [contests, total] = await Promise.all([
      prisma.contest.findMany({
        where,
        skip: (Number(page) - 1) * Number(pageSize),
        take: Number(pageSize),
        include: {
          team: { select: { id: true, name: true } },
          _count: { select: { resources: true } }
        },
        orderBy: { contestDate: 'desc' }
      }),
      prisma.contest.count({ where })
    ])

    res.json({
      success: true,
      data: { list: contests, total, page: Number(page), pageSize: Number(pageSize) }
    })
  } catch (error) {
    console.error('Get contests error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取模拟赛详情
contestRouter.get('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const contest = await prisma.contest.findUnique({
      where: { id },
      include: {
        team: { select: { id: true, name: true, school: { select: { id: true, name: true } } } },
        resources: {
          orderBy: { uploadedAt: 'desc' }
        },
        problems: {
          orderBy: { orderIndex: 'asc' }
        }
      }
    })

    if (!contest) {
      return res.status(404).json({ success: false, message: '模拟赛不存在' })
    }

    // 获取当前用户关联的学生成绩
    let studentResult = null
    if (req.user?.role === 'student') {
      const student = await prisma.student.findFirst({
        where: { userId: req.user.userId }
      })
      if (student) {
        studentResult = await prisma.contestResult.findFirst({
          where: { contestId: id, studentId: student.id }
        })
      }
    }

    // 获取排行榜数据 - 获取所有学生及其成绩
    const students = await prisma.student.findMany({
      include: {
        user: { select: { username: true } },
        contestResults: {
          where: { contestId: id }
        },
        problemScores: {
          where: { contestId: id }
        }
      }
    })

    // 构建排行榜数据
    const ranklist = students.map(student => {
      const result = student.contestResults[0]
      const problemScoresMap: { [key: string]: number | null } = {}

      // 转换单题成绩为 map
      student.problemScores.forEach(ps => {
        problemScoresMap[ps.problemId] = ps.score
      })

      return {
        studentId: student.id,
        studentName: student.name,
        username: student.user?.username || '',
        totalScore: result?.score ?? 0,
        problemScores: problemScoresMap,
        rank: result?.rank || null
      }
    })

    // 按总分排序
    ranklist.sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0))

    // 重新计算排名
    ranklist.forEach((item, index) => {
      item.rank = index + 1
    })

    res.json({ success: true, data: { ...contest, studentResult, ranklist } })
  } catch (error) {
    console.error('Get contest error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 创建比赛 (老师 + 平台管理员可创建公共比赛)
contestRouter.post('/', authenticate, async (req: AuthRequest, res: Response) => {
  try {
    const { title, description, contestDate, status, type, countRating, scope, teamId } = req.body

    // 权限检查：只有教师和管理员可以创建比赛
    if (req.user!.role !== 'teacher' && req.user!.role !== 'school_principal' && !isAdmin(req.user!.role)) {
      return res.status(403).json({ success: false, message: '权限不足' })
    }

    // V2: 训练赛和模拟赛必须绑定团队
    const contestType = type || 'mock'
    if ((contestType === 'training' || contestType === 'mock') && !teamId) {
      return res.status(400).json({
        success: false,
        message: '训练赛和模拟赛必须选择所属团队'
      })
    }

    // 公共比赛只能由管理员创建
    const contestScope = scope || 'public'
    if (contestScope === 'public' && !isAdmin(req.user!.role)) {
      return res.status(403).json({
        success: false,
        message: '只有管理员可以创建公共比赛'
      })
    }

    const contest = await prisma.contest.create({
      data: {
        title,
        description,
        contestDate: new Date(contestDate),
        status: status || 'upcoming',
        type: contestType,
        countRating: countRating === true || countRating === 'true',
        scope: contestScope,
        teamId: teamId || null // 正赛不强制绑定团队
      }
    })

    res.json({ success: true, data: contest })
  } catch (error) {
    console.error('Create contest error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 上传资料 (老师) - 支持整场和单题资料
contestRouter.post('/:id/resources', authenticate, authorize('teacher'), upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params
    const { fileType, visibleRoles, fileFormat, contestProblemId } = req.body

    if (!req.file) {
      return res.status(400).json({ success: false, message: '请上传文件' })
    }

    // 检查比赛级附件限制：只能上传1份
    if (!contestProblemId) {
      const existingContestLevelResource = await prisma.contestResource.findFirst({
        where: {
          contestId: id,
          contestProblemId: null
        }
      })
      if (existingContestLevelResource) {
        return res.status(400).json({
          success: false,
          message: '当前比赛已存在比赛级附件，请先删除原文件后再上传新文件'
        })
      }
    }

    // 自动检测文件格式
    let finalFileFormat = fileFormat
    if (!finalFileFormat) {
      const ext = req.file.originalname.toLowerCase().split('.').pop()
      finalFileFormat = (ext === 'md' || ext === 'markdown') ? 'markdown' : 'pdf'
    }

    const resource = await prisma.contestResource.create({
      data: {
        contestId: id,
        contestProblemId: contestProblemId || null,
        fileName: req.file.originalname,
        fileType: fileType || 'other',
        fileFormat: finalFileFormat,
        fileUrl: `/uploads/${req.file.filename}`,
        visibleRoles: visibleRoles || 'all',
        uploadedBy: req.user!.userId
      }
    })

    res.json({ success: true, data: resource })
  } catch (error) {
    console.error('Upload resource error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新比赛
contestRouter.put('/:id', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, contestDate, status, type, countRating, scope, teamId } = req.body

    // V2: 训练赛和模拟赛必须绑定团队
    const contestType = type
    if ((contestType === 'training' || contestType === 'mock') && !teamId) {
      return res.status(400).json({
        success: false,
        message: '训练赛和模拟赛必须选择所属团队'
      })
    }

    const contest = await prisma.contest.update({
      where: { id },
      data: {
        title,
        description,
        contestDate: contestDate ? new Date(contestDate) : undefined,
        status,
        type,
        countRating: countRating === true || countRating === 'true' ? true : countRating === false || countRating === 'false' ? false : undefined,
        scope,
        teamId: teamId || null
      }
    })

    res.json({ success: true, data: contest })
  } catch (error) {
    console.error('Update contest error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 删除模拟赛
contestRouter.delete('/:id', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    await prisma.contest.delete({ where: { id } })
    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('Delete contest error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取比赛题目列表
contestRouter.get('/:id/problems', authenticate, async (req, res) => {
  try {
    const { id } = req.params
    const problems = await prisma.contestProblem.findMany({
      where: { contestId: id },
      orderBy: { orderIndex: 'asc' }
    })
    res.json({ success: true, data: problems })
  } catch (error) {
    console.error('Get contest problems error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 添加比赛题目
contestRouter.post('/:id/problems', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    const { title, description, ojName, problemId, isCustom, difficulty, points, orderIndex, statementType, statementMarkdown, solutionType, solutionMarkdown, solutionVisible } = req.body

    // 获取当前最大 orderIndex
    const maxOrder = await prisma.contestProblem.aggregate({
      where: { contestId: id },
      _max: { orderIndex: true }
    })

    const newOrderIndex = orderIndex ?? ((maxOrder._max.orderIndex ?? 0) + 1)

    const problem = await prisma.contestProblem.create({
      data: {
        contestId: id,
        orderIndex: newOrderIndex,
        title: isCustom ? title : null,
        description: isCustom ? description : null,
        ojName: !isCustom ? ojName : null,
        problemId: !isCustom ? problemId : null,
        isCustom: isCustom === true,
        difficulty,
        points,
        // 题面设置
        statementType: statementType || 'none',
        statementMarkdown: statementMarkdown || null,
        // 题解设置
        solutionType: solutionType || 'none',
        solutionMarkdown: solutionMarkdown || null,
        solutionVisible: solutionVisible === true
      }
    })

    res.json({ success: true, data: problem })
  } catch (error) {
    console.error('Add contest problem error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 更新比赛题目
contestRouter.put('/:id/problems/:problemId', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id, problemId } = req.params
    const { title, description, ojName, problemId: newProblemId, isCustom, difficulty, points, orderIndex, statementType, statementMarkdown, solutionType, solutionMarkdown, solutionVisible } = req.body

    const problem = await prisma.contestProblem.update({
      where: { id: problemId },
      data: {
        orderIndex,
        title: isCustom ? title : null,
        description: isCustom ? description : null,
        ojName: !isCustom ? ojName : null,
        problemId: !isCustom ? newProblemId : null,
        isCustom: isCustom === true,
        difficulty,
        points,
        // 题面设置
        statementType: statementType || 'none',
        statementMarkdown: statementMarkdown || null,
        // 题解设置
        solutionType: solutionType || 'none',
        solutionMarkdown: solutionMarkdown || null,
        solutionVisible: solutionVisible === true
      }
    })

    res.json({ success: true, data: problem })
  } catch (error) {
    console.error('Update contest problem error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 删除比赛题目
contestRouter.delete('/:id/problems/:problemId', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { problemId } = req.params
    await prisma.contestProblem.delete({ where: { id: problemId } })
    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('Delete contest problem error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取比赛题目详情（含资料）
contestRouter.get('/:id/problems/:problemId', authenticate, async (req, res) => {
  try {
    const { problemId } = req.params
    const problem = await prisma.contestProblem.findUnique({
      where: { id: problemId },
      include: {
        resources: {
          orderBy: { uploadedAt: 'desc' }
        }
      }
    })

    if (!problem) {
      return res.status(404).json({ success: false, message: '题目不存在' })
    }

    res.json({ success: true, data: problem })
  } catch (error) {
    console.error('Get contest problem error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 删除比赛资料
contestRouter.delete('/:id/resources/:resourceId', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { resourceId } = req.params

    // 查找资料
    const resource = await prisma.contestResource.findUnique({
      where: { id: resourceId }
    })

    if (!resource) {
      return res.status(404).json({ success: false, message: '资料不存在' })
    }

    // 删除文件
    const filePath = path.join(__dirname, '../../', resource.fileUrl)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }

    // 删除数据库记录
    await prisma.contestResource.delete({ where: { id: resourceId } })

    res.json({ success: true, message: '删除成功' })
  } catch (error) {
    console.error('Delete resource error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 获取比赛成绩列表
contestRouter.get('/:id/results', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params

    // 获取比赛信息
    const contest = await prisma.contest.findUnique({
      where: { id }
    })

    if (!contest) {
      return res.status(404).json({ success: false, message: '比赛不存在' })
    }

    // 直接从 ContestResult 表查询有成绩的学生
    const contestResults = await prisma.contestResult.findMany({
      where: { contestId: id },
      include: {
        student: {
          include: {
            user: { select: { username: true } }
          }
        }
      }
    })

    // 单独获取各题分数
    const problemScores = await prisma.contestProblemScore.findMany({
      where: { contestId: id }
    })

    // 按学生ID分组各题分数
    const problemScoresByStudent: Record<string, Record<string, number>> = {}
    problemScores.forEach(ps => {
      if (!problemScoresByStudent[ps.studentId]) {
        problemScoresByStudent[ps.studentId] = {}
      }
      problemScoresByStudent[ps.studentId][ps.problemId] = ps.score || 0
    })

    // 整理成绩数据
    const results = contestResults.map(result => {
      return {
        studentId: result.studentId,
        studentName: result.student.name,
        username: result.student.user?.username || '',
        rank: result.rank,
        score: result.score,
        scores: problemScoresByStudent[result.studentId] || {},
        ratingBefore: result.ratingBefore,
        ratingAfter: result.ratingAfter,
        ratingChange: result.ratingChange
      }
    })

    // 按分数排序（分数高的在前），如果分数相同则按排名
    results.sort((a, b) => {
      const scoreA = a.score || 0
      const scoreB = b.score || 0
      if (scoreB !== scoreA) return scoreB - scoreA
      return (a.rank || 999) - (b.rank || 999)
    })

    res.json({ success: true, data: results })
  } catch (error) {
    console.error('Get contest results error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 保存比赛成绩 (老师)
contestRouter.post('/:id/results', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    const { results } = req.body // [{ studentId, rank, score }]

    // 获取比赛的计Rating设置
    const contest = await prisma.contest.findUnique({
      where: { id }
    })

    if (!contest) {
      return res.status(404).json({ success: false, message: '比赛不存在' })
    }

    // 过滤掉无效的成绩（必须有studentId）
    const validResults = results.filter((r: { studentId: string }) => {
      return r.studentId
    })

    // 如果没有有效成绩，返回错误
    if (validResults.length === 0) {
      return res.status(400).json({ success: false, message: '没有有效的成绩数据（排名和得分必须同时填写）' })
    }

    // 批量保存成绩
    const savedResults = await Promise.all(
      validResults.map(async (r: { studentId: string; rank?: number | string; score?: number | string; scores?: { contestProblemId: string; score: number }[] }) => {
        const studentId = r.studentId

        // 如果有各题分数，计算总分
        let totalScore = 0
        let rank = r.rank ? Number(r.rank) : 0

        if (r.scores && r.scores.length > 0) {
          // 计算总分
          totalScore = r.scores.reduce((sum, s) => sum + (s.score || 0), 0)
        } else if (r.score !== undefined) {
          totalScore = Number(r.score)
        }

        // 获取学生当前rating
        const student = await prisma.student.findUnique({
          where: { id: studentId }
        })

        const ratingBefore = student?.rating || 1200

        // 如果计rating，计算赛后rating
        let ratingAfter = ratingBefore
        let ratingChange = 0

        if (contest.countRating && totalScore > 0) {
          // 简单的rating计算：基础分 + 排名分
          const basePoints = Math.floor(totalScore)
          const rankBonus = Math.max(0, 50 - (rank - 1) * 2) // 排名前50有排名分
          ratingChange = Math.floor((basePoints + rankBonus) / 10)
          ratingAfter = ratingBefore + ratingChange
        }

        // 查询是否已有成绩
        const existing = await prisma.contestResult.findFirst({
          where: { contestId: id, studentId }
        })

        let result
        if (existing) {
          // 更新成绩
          result = await prisma.contestResult.update({
            where: { id: existing.id },
            data: {
              rank,
              score: totalScore,
              ratingBefore,
              ratingAfter,
              ratingChange
            }
          })
        } else {
          // 创建成绩
          result = await prisma.contestResult.create({
            data: {
              contestId: id,
              studentId,
              rank,
              score: totalScore,
              ratingBefore,
              ratingAfter,
              ratingChange
            }
          })
        }

        // 更新学生的当前rating
        if (contest.countRating) {
          await prisma.student.update({
            where: { id: studentId },
            data: { rating: ratingAfter }
          })
        }

        // 保存各题分数到 ContestProblemScore 表
        if (r.scores && r.scores.length > 0) {
          await Promise.all(
            r.scores.map(async (s: { contestProblemId: string; score: number }) => {
              // contestProblemId 就是 problemId
              const problemId = s.contestProblemId
              await prisma.contestProblemScore.upsert({
                where: {
                  contestId_problemId_studentId: {
                    contestId: id,
                    problemId,
                    studentId
                  }
                },
                update: { score: s.score },
                create: {
                  contestId: id,
                  problemId,
                  studentId,
                  score: s.score
                }
              })
            })
          )
        }

        return result
      })
    )

    res.json({ success: true, data: savedResults })
  } catch (error) {
    console.error('Save contest results error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 导入比赛成绩 (老师) - 支持 CSV 格式
contestRouter.post('/:id/results/import', authenticate, authorize('teacher'), async (req, res) => {
  try {
    const { id } = req.params
    const { csvData } = req.body // CSV 格式：username,score 或 username,score,rank

    if (!csvData) {
      return res.status(400).json({ success: false, message: '请提供成绩数据' })
    }

    // 解析 CSV 数据
    const lines = csvData.trim().split('\n')
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim())

    // 查找 username、score、rank 列的位置
    const usernameIdx = headers.findIndex(h => h === 'username' || h === '用户' || h === '学号')
    const scoreIdx = headers.findIndex(h => h === 'score' || h === '得分' || h === '分数')
    const rankIdx = headers.findIndex(h => h === 'rank' || h === '排名' || h === '名次')

    if (usernameIdx === -1 || scoreIdx === -1) {
      return res.status(400).json({ success: false, message: 'CSV 必须包含 username（用户名）和 score（得分）列' })
    }

    // rank 列是必需的
    if (rankIdx === -1) {
      return res.status(400).json({ success: false, message: 'CSV 必须包含 rank（排名）列' })
    }

    // 获取比赛的计Rating设置
    const contest = await prisma.contest.findUnique({
      where: { id }
    })

    if (!contest) {
      return res.status(404).json({ success: false, message: '比赛不存在' })
    }

    // 解析数据行
    const importResults: { username: string; score: number | null; rank: number | null }[] = []
    const errors: string[] = []

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim()
      if (!line) continue

      const values = line.split(',').map(v => v.trim())
      const username = values[usernameIdx]
      const score = values[scoreIdx] ? parseFloat(values[scoreIdx]) : null
      const rank = rankIdx !== -1 && values[rankIdx] ? parseInt(values[rankIdx]) : null

      if (!username) {
        errors.push(`第 ${i + 1} 行：用户名不能为空`)
        continue
      }

      if (score === null || isNaN(score)) {
        errors.push(`第 ${i + 1} 行：得分无效`)
        continue
      }

      // 验证排名必须存在
      if (rank === null || isNaN(rank)) {
        errors.push(`第 ${i + 1} 行：排名无效（排名和得分必须同时填写）`)
        continue
      }

      importResults.push({ username, score, rank })
    }

    // 查找匹配的学生
    const matchedResults: { studentId: string; score: number | null; rank: number | null }[] = []
    const notFound: string[] = []

    for (const item of importResults) {
      // 通过用户名查找学生
      const student = await prisma.student.findFirst({
        where: {
          user: { username: item.username }
        }
      })

      if (student) {
        // 只添加同时有分数和排名的记录
        if (item.score !== null && item.rank !== null) {
          matchedResults.push({
            studentId: student.id,
            score: item.score,
            rank: item.rank
          })
        }
      } else {
        notFound.push(item.username)
      }
    }

    // 如果没有有效成绩，返回错误
    if (matchedResults.length === 0) {
      return res.status(400).json({ success: false, message: '没有有效的成绩数据（排名和得分必须同时填写）' })
    }

    // 批量保存成绩
    const savedResults = await Promise.all(
      matchedResults.map(async (r) => {
        const studentId = r.studentId
        const rank = r.rank
        const score = r.score

        // 获取学生当前rating
        const student = await prisma.student.findUnique({
          where: { id: studentId }
        })

        const ratingBefore = student?.rating || 1200

        // 如果计rating，计算赛后rating
        let ratingAfter = ratingBefore
        let ratingChange = 0

        if (contest.countRating && rank && score !== null) {
          const basePoints = Math.floor(score)
          const rankBonus = Math.max(0, 50 - (rank - 1) * 2)
          ratingChange = Math.floor((basePoints + rankBonus) / 10)
          ratingAfter = ratingBefore + ratingChange
        }

        // 查询是否已有成绩
        const existing = await prisma.contestResult.findFirst({
          where: { contestId: id, studentId }
        })

        let result
        if (existing) {
          result = await prisma.contestResult.update({
            where: { id: existing.id },
            data: {
              rank,
              score,
              ratingBefore,
              ratingAfter,
              ratingChange
            }
          })
        } else {
          result = await prisma.contestResult.create({
            data: {
              contestId: id,
              studentId,
              rank,
              score,
              ratingBefore,
              ratingAfter,
              ratingChange
            }
          })
        }

        // 更新学生的当前rating
        if (contest.countRating) {
          await prisma.student.update({
            where: { id: studentId },
            data: { rating: ratingAfter }
          })
        }

        return result
      })
    )

    res.json({
      success: true,
      data: {
        successCount: savedResults.length,
        notFoundCount: notFound.length,
        notFound,
        errors,
        totalProcessed: importResults.length
      }
    })
  } catch (error) {
    console.error('Import contest results error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})

// 清理重复成绩数据（无需登录）
contestRouter.post('/cleanup-duplicates', async (req, res) => {
  try {
    // 获取所有比赛
    const contests = await prisma.contest.findMany()

    let totalDeletedResults = 0
    let totalDeletedScores = 0

    for (const contest of contests) {
      // 查找每个比赛中每个学生的所有成绩记录
      const results = await prisma.contestResult.findMany({
        where: { contestId: contest.id },
        orderBy: { createdAt: 'desc' }
      })

      // 按 studentId 分组
      const byStudent: Record<string, typeof results> = {}
      results.forEach(r => {
        if (!byStudent[r.studentId]) byStudent[r.studentId] = []
        byStudent[r.studentId].push(r)
      })

      // 对每个学生只保留最新的记录
      for (const studentId in byStudent) {
        const records = byStudent[studentId]
        if (records.length > 1) {
          // 删除除了第一条之外的所有记录
          const toDelete = records.slice(1)
          await prisma.contestResult.deleteMany({
            where: {
              id: { in: toDelete.map(r => r.id) }
            }
          })
          totalDeletedResults += toDelete.length
        }
      }

      // 同样清理各题分数
      const scores = await prisma.contestProblemScore.findMany({
        where: { contestId: contest.id }
      })

      const scoresByStudentProblem: Record<string, typeof scores> = {}
      scores.forEach(s => {
        const key = `${s.studentId}_${s.problemId}`
        if (!scoresByStudentProblem[key]) scoresByStudentProblem[key] = []
        scoresByStudentProblem[key].push(s)
      })

      for (const key in scoresByStudentProblem) {
        const records = scoresByStudentProblem[key]
        if (records.length > 1) {
          const toDelete = records.slice(1)
          await prisma.contestProblemScore.deleteMany({
            where: {
              id: { in: toDelete.map(r => r.id) }
            }
          })
          totalDeletedScores += toDelete.length
        }
      }
    }

    res.json({
      success: true,
      message: `清理完成，删除重复成绩记录 ${totalDeletedResults} 条，删除重复各题分数 ${totalDeletedScores} 条`
    })
  } catch (error) {
    console.error('Cleanup error:', error)
    res.status(500).json({ success: false, message: '服务器错误' })
  }
})
