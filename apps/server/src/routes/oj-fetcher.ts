/**
 * OJ 题目拉取 API
 * @description 从外部 OJ 平台拉取题目信息的 API 路由
 */

import { Router, Request, Response } from 'express'
import fs from 'fs'
import path from 'path'
import { prisma } from '../prisma'
import { getAdapter, isPlatformSupported, getSupportedPlatforms, OjFetchError, OjErrorCode, OJ_ERROR_HTTP_STATUS } from '../oj-adapters'

export const ojFetcherRouter = Router()

// ==================== 平台配置 API ====================

/**
 * GET /api/oj-fetcher/platforms/:platform/config
 * @description 获取平台 Cookie 配置
 */
ojFetcherRouter.get('/platforms/:platform/config', async (req: Request, res: Response) => {
  try {
    const { platform } = req.params

    const config = await prisma.ojPlatformConfig.findUnique({
      where: { platform },
    })

    // 解析 cookies JSON
    let cookies: Record<string, string> = {}
    if (config?.cookies) {
      try {
        cookies = JSON.parse(config.cookies)
      } catch {
        cookies = {}
      }
    }

    res.json({
      success: true,
      data: {
        platform,
        cookies,
        lastUsedAt: config?.lastUsedAt || null,
      },
    })
  } catch (error) {
    console.error('[OJ Fetcher] Get config error:', error)
    res.status(500).json({
      success: false,
      message: '获取配置失败',
    })
  }
})

/**
 * PUT /api/oj-fetcher/platforms/:platform/config
 * @description 更新平台 Cookie 配置
 */
ojFetcherRouter.put('/platforms/:platform/config', async (req: Request, res: Response) => {
  try {
    const { platform } = req.params
    const { cookies } = req.body

    // 将 cookies 对象转为 JSON 字符串
    const cookiesJson = cookies ? JSON.stringify(cookies) : null

    const config = await prisma.ojPlatformConfig.upsert({
      where: { platform },
      update: {
        cookies: cookiesJson,
        lastUsedAt: new Date(),
      },
      create: {
        platform,
        cookies: cookiesJson,
        lastUsedAt: new Date(),
      },
    })

    res.json({
      success: true,
      data: {
        platform: config.platform,
        cookies: cookies || {},
      },
    })
  } catch (error) {
    console.error('[OJ Fetcher] Update config error:', error)
    res.status(500).json({
      success: false,
      message: '更新配置失败',
    })
  }
})

// ==================== 拉取队列 API ====================

/**
 * GET /api/oj-fetcher/jobs
 * @description 获取拉取任务列表
 */
ojFetcherRouter.get('/jobs', async (req: Request, res: Response) => {
  try {
    const { status, platform } = req.query

    const where: any = {}
    if (status) where.status = status
    if (platform) where.platform = platform

    const jobs = await prisma.ojFetchJob.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    res.json({
      success: true,
      data: jobs,
    })
  } catch (error) {
    console.error('[OJ Fetcher] Get jobs error:', error)
    res.status(500).json({
      success: false,
      message: '获取任务列表失败',
    })
  }
})

/**
 * POST /api/oj-fetcher/jobs/batch
 * @description 批量创建拉取任务
 */
ojFetcherRouter.post('/jobs/batch', async (req: Request, res: Response) => {
  try {
    const { platform, problemIds } = req.body

    if (!platform || !problemIds || !Array.isArray(problemIds) || problemIds.length === 0) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    // 检查平台是否支持
    if (!isPlatformSupported(platform as any)) {
      return res.status(400).json({
        success: false,
        message: `不支持的 OJ 平台: ${platform}`,
      })
    }

    // 去重
    const uniqueIds = [...new Set(problemIds.map((id: string) => id.trim()).filter(Boolean))]

    // 检查已存在的任务
    const existingJobs = await prisma.ojFetchJob.findMany({
      where: {
        platform,
        problemId: { in: uniqueIds },
      },
      select: { problemId: true, status: true },
    })

    const existingMap = new Map(existingJobs.map(j => [j.problemId, j.status]))

    // 创建任务
    const results = []
    for (const problemId of uniqueIds) {
      if (existingMap.has(problemId)) {
        // 已存在，重置状态为 pending 以便重新拉取
        await prisma.ojFetchJob.update({
          where: { platform_problemId: { platform, problemId } },
          data: {
            status: 'pending',
            message: null,
            attachmentStatus: null,
          },
        })
        results.push({
          problemId,
          status: 'pending',
          isNew: false,
          reset: true,
        })
      } else {
        // 创建新任务
        const job = await prisma.ojFetchJob.create({
          data: {
            platform,
            problemId,
            status: 'pending',
          },
        })
        results.push({
          problemId,
          jobId: job.id,
          status: 'pending',
          isNew: true,
        })
      }
    }

    // 异步处理队列
    processFetchQueue(platform)

    res.json({
      success: true,
      data: {
        total: uniqueIds.length,
        new: results.filter(r => r.isNew).length,
        existing: results.filter(r => !r.isNew).length,
        results,
      },
    })
  } catch (error) {
    console.error('[OJ Fetcher] Create batch jobs error:', error)
    res.status(500).json({
      success: false,
      message: '创建任务失败',
    })
  }
})

/**
 * POST /api/oj-fetcher/jobs/:id/retry
 * @description 重试任务
 */
ojFetcherRouter.post('/jobs/:id/retry', async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    const job = await prisma.ojFetchJob.findUnique({
      where: { id },
    })

    if (!job) {
      return res.status(404).json({
        success: false,
        message: '任务不存在',
      })
    }

    // 重置状态
    await prisma.ojFetchJob.update({
      where: { id },
      data: {
        status: 'pending',
        message: null,
        attachmentStatus: null,
      },
    })

    // 异步处理
    processFetchQueue(job.platform)

    res.json({
      success: true,
      message: '任务已重置',
    })
  } catch (error) {
    console.error('[OJ Fetcher] Retry job error:', error)
    res.status(500).json({
      success: false,
      message: '重试失败',
    })
  }
})

/**
 * DELETE /api/oj-fetcher/jobs/:id
 * @description 删除任务
 */
ojFetcherRouter.delete('/jobs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params

    await prisma.ojFetchJob.delete({
      where: { id },
    })

    res.json({
      success: true,
      message: '任务已删除',
    })
  } catch (error) {
    console.error('[OJ Fetcher] Delete job error:', error)
    res.status(500).json({
      success: false,
      message: '删除失败',
    })
  }
})

// ==================== 队列处理函数 ====================

// 处理队列（防止并发）
const processingPlatforms = new Set<string>()

async function processFetchQueue(platform: string) {
  // 防止同一平台并发处理
  if (processingPlatforms.has(platform)) return
  processingPlatforms.add(platform)

  try {
    // 获取平台配置
    const config = await prisma.ojPlatformConfig.findUnique({
      where: { platform },
    })

    let cookies: Record<string, string> = {}
    if (config?.cookies) {
      try {
        cookies = JSON.parse(config.cookies)
      } catch {
        cookies = {}
      }
    }

    // 获取待处理任务（一次处理一个）
    while (true) {
      const job = await prisma.ojFetchJob.findFirst({
        where: { platform, status: 'pending' },
        orderBy: { createdAt: 'asc' },
      })

      if (!job) break

      try {
        // 更新状态为处理中
        await prisma.ojFetchJob.update({
          where: { id: job.id },
          data: { status: 'fetching' },
        })

        // 拉取题目
        const adapter = getAdapter(platform as any)

        if (!adapter.isValidProblemId(job.problemId)) {
          await prisma.ojFetchJob.update({
            where: { id: job.id },
            data: {
              status: 'failed',
              message: `无效的题号格式: ${job.problemId}`,
            },
          })
          continue
        }

        const problemData = await adapter.fetch(job.problemId)

        // 使用原始题号作为 problemCode（如 P1001，不加平台前缀）
        const problemCode = job.problemId

        // 检查该平台+题号组合是否已存在
        const existingProblem = await prisma.problem.findFirst({
          where: {
            problemCode,
            ojBindings: {
              contains: `"platform":"${platform}"`
            }
          },
        })

        // 确定题目的目标 ID（更新或新建）
        let targetProblemId: string
        let isNewProblem = false

        if (existingProblem) {
          // 更新已存在的题目
          targetProblemId = existingProblem.id
        } else {
          // 获取管理员用户作为所有者
          const adminUser = await prisma.user.findFirst({
            where: {
              role: { in: ['super_admin', 'platform_admin'] },
              status: 'active',
            },
          })

          if (!adminUser) {
            await prisma.ojFetchJob.update({
              where: { id: job.id },
              data: {
                status: 'failed',
                message: '没有可用的管理员用户作为题目所有者',
              },
            })
            continue
          }

          // 创建新题目（基本信息）
          const newProblem = await prisma.problem.create({
            data: {
              problemCode,
              title: problemData.title,
              description: problemData.description,
              statementType: 'markdown',
              timeLimit: problemData.timeLimit,
              memoryLimit: problemData.memoryLimit,
              difficulty: problemData.difficulty,
              ojBindings: JSON.stringify([{
                platform,
                problemId: job.problemId,
                url: problemData.source.url,
              }]),
              visibility: 'public',
              ownerType: 'admin',
              ownerId: adminUser.id,
              status: 'published',
            },
          })
          targetProblemId = newProblem.id
          isNewProblem = true
        }

        // 更新或创建题目
        if (!isNewProblem && existingProblem) {
          // 更新已存在的题目
          await prisma.problem.update({
            where: { id: existingProblem.id },
            data: {
              title: problemData.title,
              description: problemData.description,
              statementType: 'markdown',
              timeLimit: problemData.timeLimit,
              memoryLimit: problemData.memoryLimit,
              difficulty: problemData.difficulty,
            },
          })
        }

        // 更新任务状态
        const hasAttachment = problemData.attachments && problemData.attachments.length > 0

        if (hasAttachment && Object.keys(cookies).length > 0) {
          // 尝试下载附件
          await prisma.ojFetchJob.update({
            where: { id: job.id },
            data: {
              status: 'success',
              hasAttachment: true,
              attachmentStatus: 'pending',
              createdProblemId: targetProblemId,
            },
          })

          // 下载附件，收集链接映射
          const linkMappings: Array<{ original: string; new: string }> = []
          for (const att of problemData.attachments!) {
            try {
              const newUrl = await downloadAttachmentInternal(targetProblemId, att.downloadLink, att.filename, cookies, platform)
              linkMappings.push({ original: att.downloadLink, new: newUrl })
              await prisma.ojFetchJob.update({
                where: { id: job.id },
                data: { attachmentStatus: 'success' },
              })
            } catch (attError) {
              console.error(`[OJ Fetcher] Attachment download failed:`, attError)
              await prisma.ojFetchJob.update({
                where: { id: job.id },
                data: { attachmentStatus: 'failed', message: '附件下载失败' },
              })
            }
          }

          // 更新题面中的附件链接
          if (linkMappings.length > 0) {
            let updatedDescription = problemData.description || ''
            for (const mapping of linkMappings) {
              updatedDescription = updatedDescription.split(mapping.original).join(mapping.new)
            }
            await prisma.problem.update({
              where: { id: targetProblemId },
              data: { description: updatedDescription },
            })
            console.log(`[OJ Fetcher] Updated ${linkMappings.length} attachment links in description`)
          }
        } else {
          // 无附件或无 Cookie
          await prisma.ojFetchJob.update({
            where: { id: job.id },
            data: {
              status: 'success',
              hasAttachment: hasAttachment,
              attachmentStatus: hasAttachment ? 'skipped' : null,
              message: hasAttachment ? '无 Cookie，附件未下载' : null,
              createdProblemId: targetProblemId,
            },
          })
        }

      } catch (error: any) {
        console.error(`[OJ Fetcher] Job ${job.id} failed:`, error)
        await prisma.ojFetchJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            message: error instanceof OjFetchError ? error.message : '拉取失败',
          },
        })
      }

      // 限流：每次处理间隔 500ms
      await new Promise(resolve => setTimeout(resolve, 500))
    }
  } finally {
    processingPlatforms.delete(platform)
  }
}

// 内部下载附件函数
// 返回新的本地文件 URL，用于替换题面中的链接
async function downloadAttachmentInternal(
  problemId: string,
  url: string,
  filename: string,
  cookies: Record<string, string>,
  platform: string
): Promise<string> {
  // 构建请求头
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Referer': `https://www.${platform === 'luogu' ? 'luogu.com.cn' : platform}.com/`,
    'Origin': `https://www.${platform === 'luogu' ? 'luogu.com.cn' : platform}.com`,
  }

  // 添加 Cookie
  if (Object.keys(cookies).length > 0) {
    headers['Cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
  }

  let downloadUrl = url
  let response = await fetch(downloadUrl, { headers, redirect: 'manual' })

  // 处理重定向
  const visitedUrls = new Set<string>([downloadUrl])
  let redirectCount = 0
  while ((response.status === 301 || response.status === 302) && redirectCount < 5) {
    const location = response.headers.get('location')
    if (location && !visitedUrls.has(location)) {
      visitedUrls.add(location)
      downloadUrl = location
      response = await fetch(downloadUrl, {
        headers: downloadUrl.includes('luogu') || downloadUrl.includes(platform) ? headers : undefined,
        redirect: 'manual',
      })
      redirectCount++
    } else {
      break
    }
  }

  if (!response.ok) {
    throw new Error(`下载失败: HTTP ${response.status}`)
  }

  // 保存文件
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  const uploadDir = path.join(__dirname, '../../uploads/problems')
  if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true })
  }

  const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
  const ext = path.extname(filename) || '.dat'
  const savedFilename = uniqueSuffix + ext
  const filePath = path.join(uploadDir, savedFilename)

  fs.writeFileSync(filePath, buffer)

  const fileUrl = `/uploads/problems/${savedFilename}`
  await prisma.problemAttachment.create({
    data: {
      problemId,
      fileName: filename,
      fileSize: buffer.length,
      fileUrl,
      description: `从 ${platform} 下载的附件`,
    },
  })

  // 返回新的本地文件 URL，用于替换题面中的链接
  return fileUrl
}

/**
 * GET /api/oj-fetcher/platforms
 * @description 获取所有支持的 OJ 平台列表
 */
ojFetcherRouter.get('/platforms', async (req: Request, res: Response) => {
  try {
    const platforms = getSupportedPlatforms()
    res.json({
      success: true,
      data: platforms,
    })
  } catch (error) {
    res.status(500).json({
      success: false,
      message: '获取平台列表失败',
    })
  }
})

/**
 * GET /api/oj-fetcher/:platform/:problemId
 * @description 从指定 OJ 平台拉取题目信息
 *
 * @param platform - OJ 平台标识（luogu, codeforces 等）
 * @param problemId - 题目 ID
 *
 * @returns {OjProblem} 标准化的题目信息
 */
ojFetcherRouter.get('/:platform/:problemId', async (req: Request, res: Response) => {
  const { platform, problemId } = req.params

  try {
    // 检查平台是否支持
    if (!isPlatformSupported(platform as any)) {
      return res.status(400).json({
        success: false,
        error: {
          code: OjErrorCode.PLATFORM_NOT_SUPPORTED,
          message: `不支持的 OJ 平台: ${platform}`,
        },
      })
    }

    // 获取适配器并拉取题目
    const adapter = getAdapter(platform as any)

    // 验证题号格式
    if (!adapter.isValidProblemId(problemId)) {
      return res.status(400).json({
        success: false,
        error: {
          code: OjErrorCode.INVALID_PROBLEM_ID,
          message: `无效的${adapter.name}题号格式: ${problemId}`,
        },
      })
    }

    // 拉取题目
    const problem = await adapter.fetch(problemId)

    res.json({
      success: true,
      data: problem,
    })
  } catch (error) {
    // 统一错误处理
    if (error instanceof OjFetchError) {
      const httpStatus = OJ_ERROR_HTTP_STATUS[error.code] || 500
      return res.status(httpStatus).json({
        success: false,
        error: {
          code: error.code,
          message: error.message,
        },
      })
    }

    // 未知错误
    console.error('[OJ Fetcher] Unexpected error:', error)
    res.status(500).json({
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: '服务器内部错误',
      },
    })
  }
})

/**
 * POST /api/oj-fetcher/download-attachment
 * @description 下载 OJ 附件并保存到题目
 *
 * @body { problemId: string, url: string, filename: string }
 */
ojFetcherRouter.post('/download-attachment', async (req: Request, res: Response) => {
  try {
    const { problemId, url, filename } = req.body

    if (!problemId || !url || !filename) {
      return res.status(400).json({
        success: false,
        message: '缺少必要参数',
      })
    }

    // 检查题目是否存在
    const problem = await prisma.problem.findUnique({
      where: { id: problemId },
    })

    if (!problem) {
      return res.status(404).json({
        success: false,
        message: '题目不存在',
      })
    }

    // 准备请求头（模拟浏览器请求）
    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': '*/*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://www.luogu.com.cn/',
      'Origin': 'https://www.luogu.com.cn',
    }

    // 从环境变量读取洛谷 Cookie（可选）
    const luoguCookie = process.env.LUOGU_COOKIE
    if (luoguCookie) {
      headers['Cookie'] = luoguCookie
    }

    // 下载文件（跟随重定向）
    console.log(`[OJ Fetcher] Downloading attachment: ${filename} from ${url}`)

    // 洛谷附件下载会重定向到 OSS，需要手动处理
    let downloadUrl = url
    let response = await fetch(downloadUrl, {
      headers,
      redirect: 'manual'  // 手动处理重定向
    })

    // 处理重定向（洛谷会返回 302 重定向到 OSS）
    let redirectCount = 0
    const visitedUrls = new Set<string>([downloadUrl])
    while ((response.status === 301 || response.status === 302) && redirectCount < 5) {
      const location = response.headers.get('location')
      if (location) {
        // 检测循环重定向
        if (visitedUrls.has(location)) {
          console.error(`[OJ Fetcher] Redirect loop detected: ${location}`)
          return res.status(403).json({
            success: false,
            message: '下载失败：需要洛谷登录 Cookie。请在后端环境变量中配置 LUOGU_COOKIE。',
          })
        }
        visitedUrls.add(location)
        console.log(`[OJ Fetcher] Redirect ${response.status} -> ${location}`)
        downloadUrl = location
        // 继续使用 manual 模式处理重定向
        response = await fetch(downloadUrl, {
          headers: location.includes('luogu.com.cn') ? headers : undefined,
          redirect: 'manual'
        })
        redirectCount++
      } else {
        break
      }
    }

    if (!response.ok) {
      console.error(`[OJ Fetcher] Download failed: HTTP ${response.status}`)
      return res.status(response.status === 403 ? 403 : 502).json({
        success: false,
        message: response.status === 403
          ? '下载失败：需要洛谷登录 Cookie。请在后端环境变量中配置 LUOGU_COOKIE。'
          : `下载失败: HTTP ${response.status}`,
      })
    }

    // 获取文件内容
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    const fileSize = buffer.length

    // 确保上传目录存在
    const uploadDir = path.join(__dirname, '../../uploads/problems')
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true })
    }

    // 生成唯一文件名
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9)
    const ext = path.extname(filename) || '.dat'
    const savedFilename = uniqueSuffix + ext
    const filePath = path.join(uploadDir, savedFilename)

    // 保存文件
    fs.writeFileSync(filePath, buffer)

    // 创建附件记录
    const fileUrl = `/uploads/problems/${savedFilename}`
    const attachment = await prisma.problemAttachment.create({
      data: {
        problemId,
        fileName: filename,
        fileSize,
        fileUrl,
        description: '从洛谷下载的附件',
      },
    })

    console.log(`[OJ Fetcher] Attachment saved: ${filename} (${fileSize} bytes)`)

    res.json({
      success: true,
      data: attachment,
    })
  } catch (error) {
    console.error('[OJ Fetcher] Download attachment error:', error)
    res.status(500).json({
      success: false,
      message: '下载附件失败',
    })
  }
})
