import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { PrismaClient } from '@prisma/client'
import { chatAccounts } from '../fixtures/auth'
import { loadFixtureIds } from '../fixtures/data'

const prisma = new PrismaClient()
const ids = loadFixtureIds()
const chatUserIds = [ids.users.chatSender, ids.users.chatReceiver, ids.users.chatOutsider]

async function resetChatState() {
  const conversations = await prisma.directConversation.findMany({
    where: { OR: [{ userLowId: { in: chatUserIds } }, { userHighId: { in: chatUserIds } }] },
    select: { id: true },
  })
  const conversationIds = conversations.map(item => item.id)
  await prisma.$transaction([
    prisma.chatReport.deleteMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.chatUserEvent.deleteMany({ where: { userId: { in: chatUserIds } } }),
    prisma.directMessage.deleteMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.directConversationMember.deleteMany({ where: { conversationId: { in: conversationIds } } }),
    prisma.directConversation.deleteMany({ where: { id: { in: conversationIds } } }),
    prisma.userBlock.deleteMany({ where: { OR: [{ blockerId: { in: chatUserIds } }, { blockedId: { in: chatUserIds } }] } }),
    prisma.friendRequest.deleteMany({ where: { OR: [{ requesterId: { in: chatUserIds } }, { addresseeId: { in: chatUserIds } }] } }),
    prisma.friendship.deleteMany({ where: { OR: [{ userLowId: { in: chatUserIds } }, { userHighId: { in: chatUserIds } }] } }),
    prisma.chatPrivacySetting.deleteMany({ where: { userId: { in: chatUserIds } } }),
  ])
}

async function loggedInPage(browser: Browser, baseURL: string, account: typeof chatAccounts.sender) {
  const context = await browser.newContext({ baseURL })
  await context.addInitScript(() => {
    if (globalThis.crypto) Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined })
  })
  const response = await context.request.post('/api/auth/login', {
    data: { username: account.username, password: account.password, workspaceMode: account.workspaceMode },
  })
  expect(response.status()).toBe(200)
  return { context, page: await context.newPage() }
}

async function enableExactDiscovery(page: Page) {
  await page.goto('/account/messages')
  const discovery = page.getByRole('switch', { name: /允许完整用户名找到我/ })
  await expect(discovery).toBeVisible()
  if (!await discovery.isChecked()) {
    await discovery.focus()
    await discovery.press('Space')
  }
  await expect(discovery).toBeChecked()
}

async function establishContact(sender: Page, receiver: Page) {
  await sender.goto('/account/messages')
  await sender.getByRole('tab', { name: /联系人/ }).click()
  await sender.getByRole('searchbox', { name: '搜索用户' }).fill(chatAccounts.receiver.username)
  await sender.getByRole('button', { name: '搜索', exact: true }).click()
  const result = sender.locator('article').filter({ hasText: chatAccounts.receiver.username })
  await expect(result.locator('[data-size="md"][aria-hidden="true"]')).toBeVisible()
  await result.getByRole('button', { name: '添加联系人' }).click()
  await sender.getByRole('dialog').getByRole('button', { name: '发送申请' }).click()
  await expect(sender.getByText('联系申请已发送')).toBeVisible()

  await receiver.getByRole('tab', { name: /联系申请/ }).click()
  const request = receiver.locator('article').filter({ hasText: chatAccounts.sender.username })
  await expect(request).toBeVisible()
  await request.getByRole('button', { name: '接受' }).click()

  await sender.getByRole('tab', { name: /联系人/ }).click()
  const contact = sender.locator('article').filter({ hasText: chatAccounts.receiver.username })
  await expect(contact.getByRole('button', { name: '发消息' })).toBeVisible()
  await contact.getByRole('button', { name: '发消息' }).click()
  await expect(sender.getByLabel('消息内容')).toBeEnabled()
  await expect(sender.locator('header').filter({ hasText: `@${chatAccounts.receiver.username}` }).locator('[data-size="md"][aria-hidden="true"]')).toBeVisible()
}

async function clearConversation(context: BrowserContext, conversationId: string) {
  await context.request.post(`/api/chat/conversations/${conversationId}/clear`, { data: {} })
}

function visibleMessage(page: Page, content: string) {
  return page.locator('article').getByText(content, { exact: true })
}

test.describe.serial('direct chat browser workflow', () => {
  test.beforeEach(async () => resetChatState())
  test.afterAll(async () => prisma.$disconnect())

  test('two users complete contact, send, receive, read and reply over SSE @chat-core @chat-release @compact', async ({ browser }) => {
    const baseURL = String(test.info().project.use.baseURL)
    const sender = await loggedInPage(browser, baseURL, chatAccounts.sender)
    const receiver = await loggedInPage(browser, baseURL, chatAccounts.receiver)
    const browserErrors: string[] = []
    sender.page.on('pageerror', error => browserErrors.push(`sender:${error.message}`))
    receiver.page.on('pageerror', error => browserErrors.push(`receiver:${error.message}`))
    let conversationId = ''
    try {
      await enableExactDiscovery(receiver.page)
      await establishContact(sender.page, receiver.page)

      const firstMessage = `browser-message-${Date.now()}`
      await sender.page.getByLabel('消息内容').fill(firstMessage)
      const [sendResponse] = await Promise.all([
        sender.page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/chat\/conversations\/[^/]+\/messages$/.test(response.url())),
        sender.page.getByRole('button', { name: '发送', exact: true }).click(),
      ])
      expect(sendResponse.status()).toBe(201)
      conversationId = (await sendResponse.json()).data.conversationId
      await expect(visibleMessage(sender.page, firstMessage)).toBeVisible()
      await expect(sender.page.getByLabel('消息内容')).toHaveValue('')
      await expect(sender.page.getByRole('button', { name: '发送', exact: true })).not.toHaveAttribute('aria-busy', 'true')

      await receiver.page.getByRole('tab', { name: /^消息/ }).click()
      const incomingConversation = receiver.page.getByRole('button').filter({ hasText: chatAccounts.sender.username }).first()
      await expect(incomingConversation).toContainText(firstMessage)
      await expect(incomingConversation.locator('[data-size="md"][aria-hidden="true"]')).toBeVisible()
      await expect(incomingConversation.locator('b')).toHaveText('1')
      await incomingConversation.click()
      await expect(visibleMessage(receiver.page, firstMessage)).toBeVisible()
      const receivedMessage = receiver.page.locator('article').filter({ hasText: firstMessage })
      const receivedGroup = receivedMessage.locator('xpath=ancestor::section[1]')
      const receivedAvatar = receivedGroup.locator('[data-size="sm"][aria-hidden="true"]')
      const receivedBubble = receivedMessage.locator(':scope > div').first()
      const [avatarBox, bubbleBox] = await Promise.all([receivedAvatar.boundingBox(), receivedBubble.boundingBox()])
      expect(Math.abs((avatarBox?.y || 0) - (bubbleBox?.y || 0))).toBeLessThanOrEqual(2)
      const bubbleVisual = await receivedBubble.evaluate(element => ({ background: getComputedStyle(element).backgroundColor, border: getComputedStyle(element).borderTopWidth }))
      const listBackground = await receiver.page.locator('[class*="messageList"]').evaluate(element => getComputedStyle(element).backgroundColor)
      expect(bubbleVisual.background).not.toBe(listBackground)
      expect(bubbleVisual.border).not.toBe('0px')
      await expect(receivedMessage.getByRole('button', { name: '举报' })).toHaveCount(0)
      await receivedMessage.hover()
      await receivedMessage.getByRole('button', { name: '消息操作' }).click()
      await expect(receiver.page.getByRole('menuitem', { name: '复制' })).toBeVisible()
      await expect(receiver.page.getByRole('menuitem', { name: '举报' })).toBeVisible()
      await receiver.page.getByRole('menuitem', { name: '复制' }).click()
      await expect(receiver.page.getByText('消息已复制')).toBeVisible()
      await expect(receiver.page.getByRole('menuitem', { name: '复制' })).toBeHidden()
      const [groupBox, composerBox] = await Promise.all([receivedGroup.boundingBox(), receiver.page.getByLabel('消息内容').boundingBox()])
      expect((composerBox?.y || 0) - ((groupBox?.y || 0) + (groupBox?.height || 0))).toBeLessThan(100)
      await expect.poll(async () => {
        const response = await receiver.context.request.get('/api/chat/unread')
        return (await response.json()).data.messageUnread
      }).toBe(0)

      const reply = `browser-reply-${Date.now()}`
      await receiver.page.getByLabel('消息内容').fill(reply)
      expect((await receiver.page.getByLabel('消息内容').boundingBox())?.height).toBeLessThanOrEqual(140)
      await receiver.page.getByLabel('消息内容').dispatchEvent('keydown', { key: 'Enter', isComposing: true })
      await expect(receiver.page.getByLabel('消息内容')).toHaveValue(reply)
      await receiver.page.getByRole('button', { name: '发送', exact: true }).click()
      await expect(visibleMessage(sender.page, reply)).toBeVisible()

      for (const page of [sender.page, receiver.page]) {
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      }

      await sender.page.reload()
      await sender.page.getByRole('button').filter({ hasText: chatAccounts.receiver.username }).first().click()
      await expect(visibleMessage(sender.page, firstMessage)).toBeVisible()
      await expect(visibleMessage(sender.page, reply)).toBeVisible()
      expect(browserErrors).toEqual([])
    } finally {
      if (conversationId) {
        await clearConversation(sender.context, conversationId)
        await clearConversation(receiver.context, conversationId)
      }
      await sender.context.close()
      await receiver.context.close()
    }
  })

  test('a lost success response preserves the draft and reuses the idempotency key @chat-release', async ({ browser }) => {
    const baseURL = String(test.info().project.use.baseURL)
    const sender = await loggedInPage(browser, baseURL, chatAccounts.sender)
    const receiver = await loggedInPage(browser, baseURL, chatAccounts.receiver)
    let conversationId = ''
    try {
      await enableExactDiscovery(receiver.page)
      await establishContact(sender.page, receiver.page)
      const content = `retry-message-${Date.now()}`
      const observedIds: string[] = []
      let intercepted = false
      await sender.page.route('**/api/chat/conversations/*/messages', async route => {
        if (route.request().method() !== 'POST' || intercepted) return route.continue()
        intercepted = true
        const body = route.request().postDataJSON()
        observedIds.push(body.clientMessageId)
        const upstream = await route.fetch()
        conversationId = (await upstream.json()).data.conversationId
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ success: false, message: '模拟响应丢失' }) })
      })
      await sender.page.getByLabel('消息内容').fill(content)
      await sender.page.getByRole('button', { name: '发送', exact: true }).click()
      await expect(sender.page.getByText('模拟响应丢失')).toBeVisible()
      await expect(sender.page.getByLabel('消息内容')).toHaveValue(content)
      await expect(sender.page.getByRole('button', { name: '发送', exact: true })).toBeEnabled()
      await sender.page.unroute('**/api/chat/conversations/*/messages')
      sender.page.on('request', request => {
        if (request.method() === 'POST' && /\/messages$/.test(request.url())) observedIds.push(request.postDataJSON().clientMessageId)
      })
      await sender.page.getByRole('button', { name: '发送', exact: true }).click()
      await expect(visibleMessage(sender.page, content)).toBeVisible()
      expect(observedIds).toHaveLength(2)
      expect(observedIds[1]).toBe(observedIds[0])
      const stored = await prisma.directMessage.findMany({ where: { conversationId, content } })
      expect(stored).toHaveLength(1)
    } finally {
      if (conversationId) {
        await clearConversation(sender.context, conversationId)
        await clearConversation(receiver.context, conversationId)
      }
      await sender.context.close()
      await receiver.context.close()
    }
  })
})
