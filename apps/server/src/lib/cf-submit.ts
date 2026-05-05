/**
 * Codeforces 提交代理（Playwright 实现）
 *
 * 使用已绑定的 JSESSIONID Cookie，通过 Playwright 提交代码
 * 绕过 Cloudflare 保护
 */

import { chromium, Browser, Page } from 'playwright'
import { logger } from './logger'

const CF_BASE_URL = 'https://codeforces.com'

/**
 * CF 语言 ID 映射
 * 参考：https://codeforces.com/problemset/submit
 */
const CF_LANGUAGE_MAP: Record<string, string> = {
  'cpp': '54',      // GNU G++17 7.3.0
  'c++': '54',
  'c': '43',        // GNU GCC C11 5.1.0
  'java': '36',     // Java 1.8.0_241
  'python': '31',   // Python 3.8.10
  'py': '31',
  'python3': '31',
  'go': '32',       // Go 1.18
  'rust': '49',     // Rust 1.58.1
  'pascal': '13',   // Free Pascal 3.0.2
  'csharp': '9',    // C# 8.0
  'c#': '9',
}

/**
 * CF 评测结果映射
 */
const CF_RESULT_MAP: Record<string, string> = {
  'Accepted': 'accepted',
  'Wrong answer': 'wa',
  'Wrong Answer': 'wa',
  'Time limit exceeded': 'tle',
  'Time Limit Exceeded': 'tle',
  'Memory limit exceeded': 'mle',
  'Memory Limit Exceeded': 'mle',
  'Output limit exceeded': 'ole',
  'Output Limit Exceeded': 'ole',
  'Runtime error': 're',
  'Runtime Error': 're',
  'Compilation error': 'ce',
  'Compilation Error': 'ce',
  'Presentation error': 'pe',
  'Presentation Error': 'pe',
  'Running': 'judging',
  'Running & Judging': 'judging',
  'In queue': 'queuing',
  'Waiting': 'queuing',
  'Hacked': 'hacked',
}

export interface CfSubmitResult {
  success: boolean
  ojRemoteId?: string
  message: string
}

export interface CfPollResult {
  result: string
  timeUsed?: number
  memoryUsed?: number
  testCount?: number
}

/**
 * 映射语言到 CF 语言 ID
 */
function mapLanguage(language: string): string {
  const langId = CF_LANGUAGE_MAP[language.toLowerCase()]
  if (langId) return langId

  // 如果已经是数字 ID，直接返回
  if (/^\d+$/.test(language)) return language

  // 默认 G++17
  return '54'
}

/**
 * 提交代码到 Codeforces（Playwright 实现）
 *
 * @param jsessionid - CF JSESSIONID Cookie
 * @param problemId - CF 题号（如 "1669H"）
 * @param language - 语言（如 "cpp", "java"）
 * @param code - 源代码
 * @returns 提交结果
 */
export async function submitToCfPlaywright(
  jsessionid: string,
  problemId: string,
  language: string,
  code: string
): Promise<CfSubmitResult> {
  let browser: Browser | null = null

  try {
    // 解析题号
    const match = problemId.match(/^(\d+)([A-Z]\d*)$/)
    if (!match) {
      return { success: false, message: `无效的 CF 题号: ${problemId}` }
    }
    const [, contestId, problemIndex] = match

    logger.info('cf_submit_start', {
      action: 'cf_submit',
      metadata: { contestId, problemIndex, language, codeLength: code.length }
    })

    // 启动浏览器
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    })

    // 注入 JSESSIONID Cookie
    await context.addCookies([{
      name: 'JSESSIONID',
      value: jsessionid,
      domain: 'codeforces.com',
      path: '/',
    }])

    const page = await context.newPage()

    // 访问提交页面
    const submitUrl = `${CF_BASE_URL}/contest/${contestId}/submit/${problemIndex}`
    logger.info('cf_submit_navigating', {
      action: 'cf_submit',
      metadata: { url: submitUrl }
    })

    await page.goto(submitUrl, {
      timeout: 30000,
      waitUntil: 'domcontentloaded',
    })

    // 等待 Cloudflare challenge
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

    // 检查登录状态
    const loginForm = await page.$('form[action*="enter"]')
    if (loginForm) {
      logger.warn('cf_submit_cookie_expired', { action: 'cf_submit' })
      return { success: false, message: 'Cookie 已失效，请重新绑定 CF 账号' }
    }

    // 检查是否在提交页面（有提交表单）
    const submitForm = await page.$('form.submit-form')
    if (!submitForm) {
      // 可能是 problemset 题目，需要访问题目页面再点击提交
      logger.info('cf_submit_goto_problemset', { action: 'cf_submit' })

      const problemUrl = `${CF_BASE_URL}/problemset/problem/${contestId}/${problemIndex}`
      await page.goto(problemUrl, { timeout: 30000, waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})

      // 点击提交按钮
      const submitLink = await page.$('a[href*="submit"]')
      if (submitLink) {
        await submitLink.click()
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      }
    }

    // 选择语言
    const langId = mapLanguage(language)
    logger.info('cf_submit_selecting_language', {
      action: 'cf_submit',
      metadata: { language, langId }
    })

    // CF 使用下拉框选择语言
    const langSelect = await page.$('select[name="programTypeId"]')
    if (langSelect) {
      await langSelect.selectOption(langId)
    } else {
      // 新版 CF 可能使用按钮式选择器
      const langButton = await page.$(`input[value="${langId}"]`)
        || await page.$(`label[data-value="${langId}"]`)
      if (langButton) {
        await langButton.click()
      }
    }

    // 填充代码
    // CF 使用 Ace Editor，需要特殊处理
    const codeTextarea = await page.$('textarea[name="source"]')
    if (codeTextarea) {
      // 直接填充 textarea（某些情况下 Ace Editor 会同步）
      await codeTextarea.fill(code)
    } else {
      // Ace Editor 模式：点击编辑器后输入
      const aceEditor = await page.$('div.ace_editor')
      if (aceEditor) {
        await aceEditor.click()

        // 清空现有内容
        await page.keyboard.press('Control+A')
        await page.keyboard.press('Backspace')

        // 输入代码
        await page.keyboard.type(code, { delay: 0 })
      } else {
        logger.warn('cf_submit_no_editor', { action: 'cf_submit' })
        return { success: false, message: '找不到代码编辑器' }
      }
    }

    // 等待代码填充完成
    await page.waitForTimeout(500)

    // 提交
    const submitButton = await page.$('input[type="submit"][value*="Submit"]')
      || await page.$('button[type="submit"]')
      || await page.$('button:has-text("Submit")')

    if (!submitButton) {
      logger.warn('cf_submit_no_button', { action: 'cf_submit' })
      return { success: false, message: '找不到提交按钮' }
    }

    logger.info('cf_submit_clicking', { action: 'cf_submit' })
    await submitButton.click()

    // 等待跳转到提交状态页
    await page.waitForURL(/\/submissions\//, { timeout: 15000 }).catch(() => {})

    // 获取提交 ID
    const currentUrl = page.url()
    let ojRemoteId: string | undefined

    // 从 URL 提取
    const urlMatch = currentUrl.match(/submission\/(\d+)/)
      || currentUrl.match(/\/submissions\/(\d+)/)

    if (urlMatch) {
      ojRemoteId = urlMatch[1]
    } else {
      // 从页面表格获取最新提交 ID
      const latestRow = await page.$('table.status-frame-datatable tbody tr:first-child')
      if (latestRow) {
        const idCell = await latestRow.$('td:first-child')
        if (idCell) {
          ojRemoteId = await idCell.textContent() || undefined
          ojRemoteId = ojRemoteId?.trim()
        }
      }
    }

    if (!ojRemoteId) {
      logger.warn('cf_submit_no_id', { action: 'cf_submit', metadata: { url: currentUrl } })
      return { success: false, message: '无法获取提交 ID' }
    }

    logger.info('cf_submit_success', {
      action: 'cf_submit',
      metadata: { ojRemoteId, contestId, problemIndex }
    })

    return {
      success: true,
      ojRemoteId,
      message: '提交成功',
    }

  } catch (e: any) {
    logger.error('cf_submit_error', e, { action: 'cf_submit' })
    return {
      success: false,
      message: `提交失败: ${e.message}`,
    }
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

/**
 * 轮询 CF 评测结果
 *
 * @param jsessionid - CF JSESSIONID Cookie
 * @param submissionId - CF 提交 ID
 * @returns 评测结果
 */
export async function pollCfResultPlaywright(
  jsessionid: string,
  submissionId: string
): Promise<CfPollResult | null> {
  let browser: Browser | null = null

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    })

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    })

    await context.addCookies([{
      name: 'JSESSIONID',
      value: jsessionid,
      domain: 'codeforces.com',
      path: '/',
    }])

    const page = await context.newPage()

    // 访问提交状态页
    const statusUrl = `${CF_BASE_URL}/contest/submission/${submissionId}`
    await page.goto(statusUrl, {
      timeout: 15000,
      waitUntil: 'domcontentloaded',
    })

    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {})

    // 解析评测结果
    // CF 提交状态页结构：table.status-frame-datatable
    const resultTable = await page.$('table.status-frame-datatable')
    if (!resultTable) {
      // 尝试从页面直接解析
      const statusDiv = await page.$('div.status')
      if (statusDiv) {
        const statusText = await statusDiv.textContent() || ''
        const result = CF_RESULT_MAP[statusText.trim()] || 'queuing'
        return { result }
      }
      return null
    }

    // 找到包含指定 submissionId 的行
    const rows = await resultTable.$$('tbody tr')
    for (const row of rows) {
      const idCell = await row.$('td:first-child')
      const rowId = await idCell?.textContent() || ''

      if (rowId.trim() === submissionId) {
        // 提取评测结果（第 6 列）
        const verdictCell = await row.$('td:nth-child(6)')
        const verdict = await verdictCell?.textContent() || ''

        // 提取时间（第 7 列）
        const timeCell = await row.$('td:nth-child(7)')
        const timeText = await timeCell?.textContent() || ''
        const timeMatch = timeText.match(/(\d+)\s*ms/i)
        const timeUsed = timeMatch ? parseInt(timeMatch[1]) : undefined

        // 提取内存（第 8 列）
        const memCell = await row.$('td:nth-child(8)')
        const memText = await memCell?.textContent() || ''
        const memMatch = memText.match(/(\d+)\s*(?:KB|K)/i)
        const memoryUsed = memMatch ? parseInt(memMatch[1]) : undefined

        // 映射结果
        let result = 'queuing'
        for (const [key, value] of Object.entries(CF_RESULT_MAP)) {
          if (verdict.toLowerCase().includes(key.toLowerCase())) {
            result = value
            break
          }
        }

        logger.info('cf_poll_result', {
          action: 'cf_poll',
          metadata: { submissionId, result, timeUsed, memoryUsed }
        })

        return {
          result,
          timeUsed,
          memoryUsed,
        }
      }
    }

    // 未找到指定行，返回 null
    return null

  } catch (e: any) {
    logger.error('cf_poll_error', e, { action: 'cf_poll' })
    return null
  } finally {
    if (browser) {
      await browser.close()
    }
  }
}

/**
 * 获取 CF 提交的远程 URL
 */
export function getCfRemoteUrl(submissionId: string): string {
  return `${CF_BASE_URL}/contest/submission/${submissionId}`
}