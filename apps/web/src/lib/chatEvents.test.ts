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
})
