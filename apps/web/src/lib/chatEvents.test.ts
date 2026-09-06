import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseChatEventBlock } from './chatEvents'

describe('chat event client', () => {
  it('parses event ids and control cursors without treating heartbeats as messages', () => {
    expect(parseChatEventBlock(': heartbeat')).toBeNull()
    expect(parseChatEventBlock('id: 42\nevent: message_created\ndata: {"conversationId":"c1"}')).toEqual({ id: '42', type: 'message_created', data: '{"conversationId":"c1"}' })
    expect(parseChatEventBlock('event: ready\ndata: {"cursor":"42"}')).toEqual({ type: 'ready', data: '{"cursor":"42"}' })
  })

  it('keeps exactly one chat event connection owner in authenticated UI code', () => {
    const provider = fs.readFileSync(new URL('../components/chat/ChatProvider.tsx', import.meta.url), 'utf8')
    const button = fs.readFileSync(new URL('../components/chat/ChatButton.tsx', import.meta.url), 'utf8')
    const page = fs.readFileSync(new URL('../app/account/messages/page.tsx', import.meta.url), 'utf8')
    const layout = fs.readFileSync(new URL('../components/RoleLayout.tsx', import.meta.url), 'utf8')
    expect(provider).toContain('connectChatEvents(')
    expect(button).not.toContain('connectChatEvents(')
    expect(page).not.toContain('connectChatEvents(')
    expect(layout).toContain('<ChatProvider>')
  })

  it('keeps recovery, race prevention and per-conversation composer safeguards', () => {
    const client = fs.readFileSync(new URL('./chatEvents.ts', import.meta.url), 'utf8')
    const provider = fs.readFileSync(new URL('../components/chat/ChatProvider.tsx', import.meta.url), 'utf8')
    const page = fs.readFileSync(new URL('../app/account/messages/page.tsx', import.meta.url), 'utf8')
    expect(client).toContain('window.sessionStorage.getItem(storageKey)')
    expect(client).toContain("headers['Last-Event-ID'] = lastEventId")
    expect(provider).toContain('}, 100)')
    expect(page).toContain('new AbortController()')
    expect(page).toContain('version !== loadVersion.current')
    expect(page).toContain('beforeSeq=${oldestSeq}')
    expect(page).toContain('afterSeq=${afterSeq}')
    expect(page).toContain('useState<Record<string, string>>({})')
    expect(page).toContain('event.nativeEvent.isComposing')
    expect(page).toContain('const clientMessageId = pending?.content === content ? pending.clientMessageId : createClientUUID()')
    expect(page).toContain('{ content, clientMessageId }, account')
    expect(page).not.toContain('clientMessageId: crypto.randomUUID()')
    expect(page).toContain('finally {')
  })

  it('lets account-level users enter personal and messaging shells', () => {
    const accountLayout = fs.readFileSync(new URL('../app/account/layout.tsx', import.meta.url), 'utf8')
    const personalLayout = fs.readFileSync(new URL('../app/personal/layout.tsx', import.meta.url), 'utf8')
    expect(accountLayout).toContain("'student', 'user'")
    expect(personalLayout).toContain("'student', 'user'")
  })

  it('renders the shared avatar and compact chat presentation in every identity surface', () => {
    const avatar = fs.readFileSync(new URL('../components/user/UserAvatar.tsx', import.meta.url), 'utf8')
    const page = fs.readFileSync(new URL('../app/account/messages/page.tsx', import.meta.url), 'utf8')
    expect(avatar).toContain("onError={() => setFailed(true)}")
    expect(avatar).toContain('firstCharacter(label)')
    expect(page).toContain('formatConversationTime(item.lastMessageAt)')
    expect(page).toContain('groupMessages(messages)')
    expect(page).toContain('styles.messageFlow')
    expect(page).toContain('label="消息操作"')
    expect(page).toContain('side="top"')
    expect(page).toContain('copyText(message.content)')
    expect(page).toContain('ref={composerRef}')
    expect(page.match(/<UserAvatar/g)?.length).toBeGreaterThanOrEqual(7)
    expect(page).not.toContain("toLocaleString('zh-CN')")
  })

  it('supports platform sticker packs without weakening text message compatibility', () => {
    const page = fs.readFileSync(new URL('../app/account/messages/page.tsx', import.meta.url), 'utf8')
    const picker = fs.readFileSync(new URL('../components/chat/StickerPicker.tsx', import.meta.url), 'utf8')
    expect(page).toContain("apiClient.get<ChatStickerPack[]>('/api/chat/sticker-packs'")
    expect(page).toContain("{ type: 'sticker', stickerId: sticker.id, clientMessageId }")
    expect(page).toContain('<StickerMessage')
    expect(picker).toContain('prefers-reduced-motion: reduce')
    expect(picker).toContain('if (!packs.length) return null')
    expect(picker).toContain('if (await onSelect(sticker)) close()')
  })
})
