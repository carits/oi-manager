import AxeBuilder from '@axe-core/playwright'
import { expect, type ConsoleMessage, type Page, type Response } from '@playwright/test'

const ignoredConsolePatterns = [
  /Download the React DevTools/,
  // Next can abort a speculative RSC prefetch when this audit immediately
  // navigates to another discovered link. It explicitly falls back to a full
  // browser navigation; the destination is still checked by the same audit.
  /^Failed to fetch RSC payload for .* Falling back to browser navigation\. TypeError: (?:Failed to fetch|network error)/,
]

export interface PageAudit {
  consoleErrors: string[]
  pageErrors: string[]
  failedResponses: string[]
  stop: () => void
}

export function watchPage(page: Page): PageAudit {
  const audit = {
    consoleErrors: [],
    pageErrors: [],
    failedResponses: [],
  } as PageAudit

  const onConsole = (message: ConsoleMessage) => {
    if (message.type() !== 'error') return
    const text = message.text()
    if (!ignoredConsolePatterns.some(pattern => pattern.test(text))) {
      audit.consoleErrors.push(text)
    }
  }

  const onPageError = (error: Error) => {
    audit.pageErrors.push(error.message)
  }

  const onResponse = (response: Response) => {
    const url = new URL(response.url())
    if (
      url.pathname.startsWith('/api/') &&
      response.status() >= 400 &&
      !url.pathname.includes('/api/files/')
    ) {
      audit.failedResponses.push(`${response.status()} ${url.pathname}`)
    }
  }

  page.on('console', onConsole)
  page.on('pageerror', onPageError)
  page.on('response', onResponse)
  audit.stop = () => {
    page.off('console', onConsole)
    page.off('pageerror', onPageError)
    page.off('response', onResponse)
  }

  return audit
}

export async function waitForPageReady(page: Page) {
  await expect(page.locator('body')).toBeVisible()
  await expect.poll(async () => {
    const text = (await page.locator('body').innerText()).trim()
    return text.length > 0 && text !== '加载中...' && text !== '正在跳转...'
  }).toBe(true)
}

export async function assertPageHealth(
  page: Page,
  audit: PageAudit,
  { checkAccessibility = true }: { checkAccessibility?: boolean } = {},
) {
  audit.stop()
  const body = await page.locator('body').innerText()
  expect(body).not.toMatch(/404|This page could not be found/i)
  expect(body).not.toContain('加载中')
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

  if (checkAccessibility) await assertAccessibleState(page)
}

/** Run the blocking accessibility gate after a dialog, picker, menu, or drawer opens. */
export async function assertAccessibleState(page: Page) {
  const blockingViolations = (await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze())
    .violations
    .filter(violation => violation.impact === 'critical' || violation.impact === 'serious')

  expect(
    blockingViolations.map(violation => ({
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
