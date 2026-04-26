/**
 * ⚠️ 已废弃 — 此脚本直接操作数据库，违反项目规范
 * 所有数据操作必须通过 API 进行，禁止脚本直接读写数据库
 * 如需类似功能，请创建对应的 API 端点
 * 详见 CLAUDE.md "禁止直接操作数据库" 规则
 */

/**
 * 修复 HDU 提交记录的内存和时间数据
 *
 * 背景：旧代码将 HDU 的 KB 内存错误地转换为 MB 存入数据库
 * 本脚本通过 ojRemoteId 去 HDU 网站获取正确的数据并更新
 */

import { PrismaClient } from '@prisma/client'
import { pollHduResult } from '../src/lib/hdu-submit'

const prisma = new PrismaClient()

async function fixHduMemory() {
  console.log('开始修复 HDU 提交记录...')

  // 查询所有 HDU 提交
  const hduSubmissions = await prisma.submission.findMany({
    where: {
      oj: 'hdu',
      ojRemoteId: { not: null },
    },
    select: {
      id: true,
      ojRemoteId: true,
      timeUsed: true,
      memoryUsed: true,
      result: true,
    },
  })

  console.log(`找到 ${hduSubmissions.length} 条 HDU 提交记录`)

  let updatedCount = 0
  let errorCount = 0

  for (const submission of hduSubmissions) {
    try {
      console.log(`处理提交 ${submission.id}, ojRemoteId=${submission.ojRemoteId}`)

      // 从 HDU 获取最新数据
      const result = await pollHduResult({}, submission.ojRemoteId!)

      if (result && result.timeUsed !== undefined && result.memoryUsed !== undefined) {
        // 更新数据库
        await prisma.submission.update({
          where: { id: submission.id },
          data: {
            timeUsed: result.timeUsed,
            memoryUsed: result.memoryUsed,  // 现在是 KB 原始值
          },
        })

        console.log(`  更新成功: time=${result.timeUsed}MS, memory=${result.memoryUsed}KB`)
        updatedCount++
      } else {
        console.log(`  无法获取数据，跳过`)
      }

      // 避免请求过快
      await new Promise(resolve => setTimeout(resolve, 500))
    } catch (error: any) {
      console.error(`  处理失败: ${error.message}`)
      errorCount++
    }
  }

  console.log('\n修复完成:')
  console.log(`  成功更新: ${updatedCount} 条`)
  console.log(`  处理失败: ${errorCount} 条`)

  await prisma.$disconnect()
}

fixHduMemory().catch(console.error)
