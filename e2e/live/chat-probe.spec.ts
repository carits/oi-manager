import { randomUUID } from 'node:crypto'
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const sender = {
  username: process.env.CHAT_PROBE_SENDER_USERNAME || '',
  password: process.env.CHAT_PROBE_SENDER_PASSWORD || '',
}
const receiver = {
  username: process.env.CHAT_PROBE_RECEIVER_USERNAME || '',
  password: process.env.CHAT_PROBE_RECEIVER_PASSWORD || '',
}
const buildId = process.env.E2E_LIVE_BUILD_ID || 'unknown-build'

async function probeContext(browser: Browser, account: typeof sender) {
  const context = await browser.newContext({ baseURL: process.env.E2E_LIVE_BASE_URL })
  await context.addInitScript(() => {
    if (globalThis.crypto) Object.defineProperty(globalThis.crypto, 'randomUUID', { configurable: true, value: undefined })
  })
  const login = await context.request.post('/api/auth/login', {
    data: { username: account.username, password: account.password, workspaceMode: 'personal' },
  })
  expect(login.status()).toBe(200)
  return { context, page: await context.newPage() }
}

async function clear(context: BrowserContext, conversationId: string) {
  const response = await context.request.post(`/api/chat/conversations/${conversationId}/clear`, { data: {} })
  expect(response.status()).toBe(200)
}

function visibleMessage(page: Page, content: string) {
  return page.locator('article').getByText(content, { exact: true })
}

test.beforeAll(() => {
  if (!sender.username || !sender.password || !receiver.username || !receiver.password) {
    throw new Error('Dedicated CHAT_PROBE sender and receiver credentials are required')
  }
})

test('production chat send, SSE receive, read and reply probe', async ({ browser }) => {
  const startedAt = Date.now()
  const senderSession = await probeContext(browser, sender)
  const receiverSession = await probeContext(browser, receiver)
  const errors: string[] = []
  senderSession.page.on('pageerror', error => errors.push(`sender:${error.message}`))
  receiverSession.page.on('pageerror', error => errors.push(`receiver:${error.message}`))
  let conversationId = ''
  let requestId = ''
  let sentSeq = 0
  let replySeq = 0
  try {
    const listResponse = await senderSession.context.request.get('/api/chat/conversations?pagination=v2&pageSize=10&scope=active')
    expect(listResponse.status()).toBe(200)
    const probeConversation = (await listResponse.json()).data.items.find((item: any) => item.other?.username === receiver.username)
    expect(probeConversation).toBeTruthy()
    conversationId = probeConversation.id
    await Promise.all([senderSession.page.goto('/account/messages'), receiverSession.page.goto('/account/messages')])
    const senderConversation = senderSession.page.getByRole('button').filter({ hasText: receiver.username }).first()
    await expect(senderConversation).toBeVisible()
    await senderConversation.click()
    await expect(senderSession.page.getByLabel('消息内容')).toBeEnabled()

    const marker = `chat-probe:${buildId}:${randomUUID()}`
    await senderSession.page.getByLabel('消息内容').fill(marker)
    const [sent] = await Promise.all([
      senderSession.page.waitForResponse(response => response.request().method() === 'POST' && /\/api\/chat\/conversations\/[^/]+\/messages$/.test(response.url())),
      senderSession.page.getByRole('button', { name: '发送', exact: true }).click(),
    ])
    expect(sent.status()).toBe(201)
    requestId = sent.headers()['x-request-id'] || ''
    const sentBody = await sent.json()
    expect(sentBody.data.conversationId).toBe(conversationId)
    sentSeq = sentBody.data.seq
    await expect(visibleMessage(senderSession.page, marker)).toBeVisible()

    const receiverConversation = receiverSession.page.getByRole('button').filter({ hasText: sender.username }).first()
    await expect(receiverConversation).toContainText(marker)
    await expect(receiverConversation.locator('b')).toHaveText('1')
    await receiverConversation.click()
    await expect(visibleMessage(receiverSession.page, marker)).toBeVisible()
    await expect.poll(async () => {
      const unread = await receiverSession.context.request.get('/api/chat/unread')
      return (await unread.json()).data.messageUnread
    }).toBe(0)

    const reply = `chat-probe-reply:${buildId}:${randomUUID()}`
    await receiverSession.page.getByLabel('消息内容').fill(reply)
    const [replyResponse] = await Promise.all([
      receiverSession.page.waitForResponse(response => response.request().method() === 'POST' && /\/messages$/.test(response.url())),
      receiverSession.page.getByRole('button', { name: '发送', exact: true }).click(),
    ])
    expect(replyResponse.status()).toBe(201)
    replySeq = (await replyResponse.json()).data.seq
    await expect(visibleMessage(senderSession.page, reply)).toBeVisible()
    expect(errors).toEqual([])
    console.log(JSON.stringify({ type: 'chat_probe', buildId, requestId, conversationId, sentSeq, replySeq, durationMs: Date.now() - startedAt }))
  } finally {
    if (conversationId) {
      await clear(senderSession.context, conversationId)
      await clear(receiverSession.context, conversationId)
    }
    await senderSession.context.close()
    await receiverSession.context.close()
  }
})
