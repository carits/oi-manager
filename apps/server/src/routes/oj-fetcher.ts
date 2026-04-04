/**
 * OJ 题目拉取 API
 * @description 从外部 OJ 平台拉取题目信息的 API 路由
 */

import { Router, Request, Response } from 'express'
import path from 'path'
import { prisma } from '../prisma'
import { getAdapter, isPlatformSupported, getSupportedPlatforms, isKnownPlatform, KNOWN_OJ_PLATFORMS, OjFetchError, OjErrorCode, OJ_ERROR_HTTP_STATUS } from '../oj-adapters'
import { fileService } from '../lib/storage'

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
 * @description 获取拉取任务列表（支持筛选和分页）
 * @query status - 按状态筛选
 * @query platform - 按平台筛选
 * @query problemId - 按题号搜索（模糊匹配）
 * @query page - 页码（默认1）
 * @query pageSize - 每页条数（默认20）
 */
ojFetcherRouter.get('/jobs', async (req: Request, res: Response) => {
  try {
    const { status, platform, problemId, page = '1', pageSize = '20' } = req.query

    const where: any = {}
    if (status) where.status = status
    if (platform) where.platform = platform
    if (problemId && typeof problemId === 'string') {
      where.problemId = { contains: problemId }
    }

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1)
    const pageSizeNum = Math.min(100, Math.max(1, parseInt(pageSize as string, 10) || 20))

    const [jobs, total] = await Promise.all([
      prisma.ojFetchJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (pageNum - 1) * pageSizeNum,
        take: pageSizeNum,
      }),
      prisma.ojFetchJob.count({ where }),
    ])

    res.json({
      success: true,
      data: {
        list: jobs,
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      },
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

    // 检查平台是否在已知白名单中
    if (!isKnownPlatform(platform)) {
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

          // 判断题面类型：如果有 PDF 格式的 statement，则设为 pdf
          const pdfStatement = problemData.statements?.find(s => s.format === 'pdf' && s.fileUrl)
          const statementType = pdfStatement ? 'pdf' : 'markdown'
          const statementPdfUrl = pdfStatement?.fileUrl || null

          // 创建新题目（基本信息）
          const newProblem = await prisma.problem.create({
            data: {
              problemCode,
              title: problemData.title,
              description: problemData.description,
              statementType,
              statementPdfUrl,
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

          // 创建多语言题面记录
          if (problemData.statements && problemData.statements.length > 0) {
            for (const stmt of problemData.statements) {
              await prisma.problemStatement.create({
                data: {
                  problemId: targetProblemId,
                  type: stmt.type,
                  format: stmt.format,
                  language: stmt.language || null,
                  content: stmt.content || null,
                  fileUrl: stmt.fileUrl || null,
                  isVisible: stmt.isVisible,
                },
              })
            }
            console.log(`[OJ Fetcher] Created ${problemData.statements.length} statement records for problem ${targetProblemId}`)
          }
        }

        // 更新或创建题目
        if (!isNewProblem && existingProblem) {
          // 更新已存在的题目 - 先清理旧的图片文件
          const oldImages = await prisma.file.findMany({
            where: { ownerType: 'problem', ownerId: existingProblem.id, category: 'image' }
          })
          for (const img of oldImages) {
            await fileService.hardDelete(img.id).catch(() => {})
          }
          console.log(`[OJ Fetcher] Cleaned ${oldImages.length} old images for problem ${existingProblem.id}`)

          // 更新时也检测 PDF 题面
          const pdfStatementUpdate = problemData.statements?.find(s => s.format === 'pdf' && s.fileUrl)
          const updateStatementType = pdfStatementUpdate ? 'pdf' : 'markdown'
          const updateStatementPdfUrl = pdfStatementUpdate?.fileUrl || null

          await prisma.problem.update({
            where: { id: existingProblem.id },
            data: {
              title: problemData.title,
              description: problemData.description,
              statementType: updateStatementType,
              statementPdfUrl: updateStatementPdfUrl,
              timeLimit: problemData.timeLimit,
              memoryLimit: problemData.memoryLimit,
              difficulty: problemData.difficulty,
            },
          })

          // 重建 ProblemStatement 记录（先删旧的再创建）
          if (problemData.statements && problemData.statements.length > 0) {
            const deleted = await prisma.problemStatement.deleteMany({
              where: { problemId: existingProblem.id },
            })
            console.log(`[OJ Fetcher] Deleted ${deleted.count} old statements for problem ${existingProblem.id}`)

            for (const stmt of problemData.statements) {
              await prisma.problemStatement.create({
                data: {
                  problemId: existingProblem.id,
                  type: stmt.type,
                  format: stmt.format,
                  language: stmt.language || null,
                  content: stmt.content || null,
                  fileUrl: stmt.fileUrl || null,
                  isVisible: stmt.isVisible,
                },
              })
            }
            console.log(`[OJ Fetcher] Recreated ${problemData.statements.length} statement records for problem ${existingProblem.id}`)
          }
        }

        // 更新任务状态
        const hasAttachment = problemData.attachments && problemData.attachments.length > 0

        // 先处理 Markdown 中的图片（公开 CDN 图片不需要 Cookie）
        let processedDescription = problemData.description || ''
        if (processedDescription) {
          processedDescription = await processMarkdownImages(targetProblemId, processedDescription, cookies)
        }

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
            for (const mapping of linkMappings) {
              processedDescription = processedDescription.split(mapping.original).join(mapping.new)
            }
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

        // 如果处理后的内容有变化，更新数据库
        if (processedDescription !== problemData.description) {
          await prisma.problem.update({
            where: { id: targetProblemId },
            data: { description: processedDescription },
          })
          console.log(`[OJ Fetcher] Updated problem description with processed images/attachments`)
        }

        // 同时处理 ProblemStatement 中的图片
        const statements = await prisma.problemStatement.findMany({
          where: { problemId: targetProblemId },
        })
        for (const stmt of statements) {
          if (stmt.content && extractImageLinks(stmt.content).length > 0) {
            const processedContent = await processMarkdownImages(targetProblemId, stmt.content, cookies)
            if (processedContent !== stmt.content) {
              await prisma.problemStatement.update({
                where: { id: stmt.id },
                data: { content: processedContent },
              })
              console.log(`[OJ Fetcher] Updated statement ${stmt.id} with processed images`)
            }
          }
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
// 返回新的文件 URL（/api/files/:id/download 格式），用于替换题面中的链接
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

  // 获取文件内容
  const arrayBuffer = await response.arrayBuffer()
  const buffer = Buffer.from(arrayBuffer)

  // 判断文件类型
  const ext = path.extname(filename).toLowerCase()
  const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)

  // 根据文件类型确定 MIME 类型
  const mimeType = getMimeType(ext)

  // 检查是否已存在同名附件（重新拉取时覆盖）
  const existingAttachment = await prisma.problemAttachment.findFirst({
    where: { problemId, fileName: filename }
  })

  if (existingAttachment) {
    // 删除旧的文件记录和物理文件
    if (existingAttachment.fileUrl.startsWith('/api/files/')) {
      const fileId = existingAttachment.fileUrl.split('/')[3]
      await fileService.hardDelete(fileId).catch(() => {})
    }
    // 删除旧的附件记录
    await prisma.problemAttachment.delete({ where: { id: existingAttachment.id } })
    console.log(`[OJ Fetcher] Deleted existing attachment: ${filename}`)
  }

  // 检查是否已存在同名图片（重新拉取时覆盖）
  if (isImage) {
    const existingFile = await prisma.file.findFirst({
      where: {
        ownerType: 'problem',
        ownerId: problemId,
        category: 'image',
        originalName: filename
      }
    })
    if (existingFile) {
      await fileService.hardDelete(existingFile.id).catch(() => {})
      console.log(`[OJ Fetcher] Deleted existing image: ${filename}`)
    }
  }

  // 使用 FileService 上传文件
  const result = await fileService.upload(buffer, {
    category: isImage ? 'image' : 'attachment',
    ownerType: 'problem',
    ownerId: problemId,
    originalName: filename,
    mimeType: mimeType,
    isPublic: isImage // 图片公开访问，附件私有访问
  })

  // 如果是附件（非图片），创建 ProblemAttachment 记录
  if (!isImage) {
    await prisma.problemAttachment.create({
      data: {
        problemId,
        fileName: filename,
        fileSize: buffer.length,
        fileUrl: result.fileUrl,
        description: `从 ${platform} 下载的附件`,
      },
    })
  }

  // 返回新的文件 URL
  return result.fileUrl
}

// 根据扩展名获取 MIME 类型
function getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.zip': 'application/zip',
    '.rar': 'application/x-rar-compressed',
    '.7z': 'application/x-7z-compressed',
    '.txt': 'text/plain',
    '.cpp': 'text/x-c++src',
    '.c': 'text/x-csrc',
    '.py': 'text/x-python',
    '.java': 'text/x-java-source',
    '.pas': 'text/x-pascal',
    '.in': 'text/plain',
    '.out': 'text/plain',
    '.ans': 'text/plain',
    '.md': 'text/markdown',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * 解析 Markdown 中的图片链接
 * @returns 匹配到的图片链接数组，包含完整匹配和 URL
 */
function extractImageLinks(markdown: string): Array<{ fullMatch: string; url: string }> {
  const images: Array<{ fullMatch: string; url: string }> = []
  // 匹配 Markdown 图片语法：![alt](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match
  while ((match = imageRegex.exec(markdown)) !== null) {
    const url = match[2]
    // 下载所有 http/https 图片，不再限制域名白名单
    // 排除已上传到本地的图片（/api/files/ 路径）和 data: 协议
    if (
      (url.startsWith('http://') || url.startsWith('https://')) &&
      !url.includes('/api/files/')
    ) {
      images.push({
        fullMatch: match[0],
        url: url
      })
    }
  }
  return images
}

/**
 * 下载图片并上传到 FileService
 * @returns 新的图片 URL
 */
async function downloadAndUploadImage(
  problemId: string,
  imageUrl: string,
  cookies: Record<string, string>
): Promise<string | null> {
  try {
    // 构建完整 URL
    let fullUrl = imageUrl
    if (imageUrl.startsWith('/fileApi/')) {
      fullUrl = `https://www.luogu.com.cn${imageUrl}`
    }

    // 根据图片域名自动推断 Referer
    const parsedUrl = new URL(fullUrl)
    const referer = `${parsedUrl.protocol}//${parsedUrl.host}/`

    const headers: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': referer,
    }

    if (Object.keys(cookies).length > 0) {
      headers['Cookie'] = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')
    }

    // 下载图片
    let response = await fetch(fullUrl, { headers, redirect: 'manual' })

    // 处理重定向
    let redirectCount = 0
    while ((response.status === 301 || response.status === 302) && redirectCount < 5) {
      const location = response.headers.get('location')
      if (location) {
        fullUrl = location
        // 重定向时使用目标域名的 Referer
        try {
          const redirectParsed = new URL(location)
          headers['Referer'] = `${redirectParsed.protocol}//${redirectParsed.host}/`
        } catch { /* keep existing referer */ }
        response = await fetch(fullUrl, {
          headers,
          redirect: 'manual',
        })
        redirectCount++
      } else {
        break
      }
    }

    if (!response.ok) {
      console.error(`[OJ Fetcher] Image download failed: ${imageUrl}, status: ${response.status}`)
      return null
    }

    // 获取图片内容
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)

    // 从 URL 或 Content-Type 推断扩展名
    let ext = path.extname(new URL(fullUrl).pathname).toLowerCase()
    if (!ext || !['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
      // 从 Content-Type 推断
      const contentType = response.headers.get('content-type') || ''
      if (contentType.includes('png')) ext = '.png'
      else if (contentType.includes('gif')) ext = '.gif'
      else if (contentType.includes('webp')) ext = '.webp'
      else ext = '.jpg' // 默认 jpg
    }

    // 生成文件名
    const filename = `image-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    const mimeType = getMimeType(ext)

    // 使用 FileService 上传图片
    const result = await fileService.upload(buffer, {
      category: 'image',
      ownerType: 'problem',
      ownerId: problemId,
      originalName: filename,
      mimeType: mimeType,
      isPublic: true // 图片公开访问
    })

    console.log(`[OJ Fetcher] Image uploaded: ${imageUrl} -> ${result.fileUrl}`)
    return result.fileUrl
  } catch (error) {
    console.error(`[OJ Fetcher] Image upload failed: ${imageUrl}`, error)
    return null
  }
}

/**
 * 处理 Markdown 内容中的图片链接
 * 下载图片并替换为本地 URL
 */
async function processMarkdownImages(
  problemId: string,
  markdown: string,
  cookies: Record<string, string>
): Promise<string> {
  const images = extractImageLinks(markdown)

  if (images.length === 0) {
    return markdown
  }

  console.log(`[OJ Fetcher] Found ${images.length} images in markdown`)

  let updatedMarkdown = markdown
  for (const image of images) {
    const newUrl = await downloadAndUploadImage(problemId, image.url, cookies)
    if (newUrl) {
      // 替换图片 URL
      updatedMarkdown = updatedMarkdown.replace(
        image.fullMatch,
        image.fullMatch.replace(image.url, newUrl)
      )
    }
  }

  return updatedMarkdown
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

    // 处理图片：下载远程图片到本地
    try {
      if (problem.description) {
        problem.description = await processMarkdownImages(
          `pre-fetch-${platform}-${problemId}`,
          problem.description,
          {}
        )
      }
      if (problem.statements) {
        for (const stmt of problem.statements) {
          if (stmt.content) {
            stmt.content = await processMarkdownImages(
              `pre-fetch-${platform}-${problemId}`,
              stmt.content,
              {}
            )
          }
        }
      }
    } catch (imgError) {
      console.error('[OJ Fetcher] Image processing failed (non-fatal):', imgError)
      // 图片下载失败不影响题目拉取结果
    }

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

    // 判断文件类型
    const ext = path.extname(filename).toLowerCase()
    const isImage = ['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)
    const mimeType = getMimeType(ext)

    // 使用 FileService 上传文件
    const result = await fileService.upload(buffer, {
      category: isImage ? 'image' : 'attachment',
      ownerType: 'problem',
      ownerId: problemId,
      originalName: filename,
      mimeType: mimeType,
      isPublic: isImage // 图片公开访问，附件私有访问
    })

    // 如果是附件（非图片），创建 ProblemAttachment 记录
    let attachment = null
    if (!isImage) {
      attachment = await prisma.problemAttachment.create({
        data: {
          problemId,
          fileName: filename,
          fileSize: buffer.length,
          fileUrl: result.fileUrl,
          description: '从洛谷下载的附件',
        },
      })
    }

    console.log(`[OJ Fetcher] File saved: ${filename} (${buffer.length} bytes, ${isImage ? 'image' : 'attachment'})`)

    res.json({
      success: true,
      data: attachment || {
        id: result.id,
        fileName: filename,
        fileSize: buffer.length,
        fileUrl: result.fileUrl,
        isImage: true,
      },
    })
  } catch (error) {
    console.error('[OJ Fetcher] Download attachment error:', error)
    res.status(500).json({
      success: false,
      message: '下载附件失败',
    })
  }
})
