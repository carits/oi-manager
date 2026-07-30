import AxeBuilder from '@axe-core/playwright'
import { expect, type Page, type Response } from '@playwright/test'

const ignoredConsolePatterns = [
  /Download the React DevTools/,
]

export interface PageAudit {
  consoleErrors: string[]
  pageErrors: string[]
  failedResponses: string[]
}

export function watchPage(page: Page): PageAudit {
  const audit: PageAudit = {
    consoleErrors: [],
    pageErrors: [],
    failedResponses: [],
  }

  page.on('console', message => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (!ignoredConsolePatterns.some(pattern => pattern.test(text))) {
      audit.consoleErrors.push(text)
    }
  })

  page.on('pageerror', error => {
    audit.pageErrors.push(error.message)
  })

  page.on('response', (response: Response) => {
    const url = new URL(response.url())
    if (
      url.pathname.startsWith('/api/') &&
      response.status() >= 400 &&
      !url.pathname.includes('/api/files/')
    ) {
      audit.failedResponses.push(`${response.status()} ${url.pathname}`)
    }
  })

  return audit
}

export async function waitForPageReady(page: Page) {
  await expect(page.locator('body')).toBeVisible()
  await expect.poll(async () => {
    const text = (await page.locator('body').innerText()).trim()
    return text.length > 0 && text !== '加载中...' && text !== '正在跳转...'
  }).toBe(true)
}

export async function assertPageHealth(page: Page, audit: PageAudit) {
  const body = await page.locator('body').innerText()
  expect(body).not.toMatch(/404|This page could not be found/i)
  expect(audit.pageErrors).toEqual([])
  expect(audit.consoleErrors).toEqual([])
  expect(audit.failedResponses).toEqual([])

  const overflow = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }))
  expect(overflow.document, `document width ${overflow.document} exceeds ${overflow.viewport}`).toBeLessThanOrEqual(
    overflow.viewport + 1,
  )

  const criticalViolations = (await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze())
    .violations
    .filter(violation => violation.impact === 'critical')

  expect(
    criticalViolations.map(violation => ({
      id: violation.id,
      nodes: violation.nodes.map(node => node.target),
    })),
  ).toEqual([])
}

export async function assertVisibleControlsFit(page: Page) {
  const clippedControls = await page.locator('button, a, input, select, textarea').evaluateAll(elements =>
    elements.flatMap(element => {
      const rect = element.getBoundingClientRect()
      const style = window.getComputedStyle(element)
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.visibility === 'hidden' ||
        style.display === 'none'
      ) {
        return []
      }
      if (rect.left < -1 || rect.right > window.innerWidth + 1) {
        return [{
          tag: element.tagName,
          text: (element.textContent || element.getAttribute('aria-label') || '').trim().slice(0, 80),
          left: rect.left,
          right: rect.right,
        }]
      }
      return []
    }),
  )

  expect(clippedControls).toEqual([])
}
