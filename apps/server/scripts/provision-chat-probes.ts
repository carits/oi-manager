import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const apply = process.argv.includes('--apply')
const sender = {
  id: 'system-chat-probe-sender',
  username: process.env.CHAT_PROBE_SENDER_USERNAME || '__chat_probe_sender__',
  password: process.env.CHAT_PROBE_SENDER_PASSWORD || '',
}
const receiver = {
  id: 'system-chat-probe-receiver',
  username: process.env.CHAT_PROBE_RECEIVER_USERNAME || '__chat_probe_receiver__',
  password: process.env.CHAT_PROBE_RECEIVER_PASSWORD || '',
}

async function main() {
  if (!sender.password || !receiver.password) throw new Error('CHAT_PROBE sender and receiver passwords are required')
  if (!apply) {
    console.log(JSON.stringify({ apply: false, users: [sender.username, receiver.username] }))
    return
  }
  const senderHash = await bcrypt.hash(sender.password, 12)
  const receiverHash = await bcrypt.hash(receiver.password, 12)
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('chat-production-probes', 0))`
    for (const probe of [sender, receiver]) {
      const existing = await tx.user.findUnique({ where: { username: probe.username }, select: { id: true } })
      if (existing && existing.id !== probe.id) throw new Error(`Reserved probe username already belongs to another account: ${probe.username}`)
    }
    await tx.user.upsert({
      where: { username: sender.username },
      create: { id: sender.id, username: sender.username, passwordHash: senderHash, role: 'user', status: 'active' },
      update: { passwordHash: senderHash, role: 'user', status: 'active' },
    })
    await tx.user.upsert({
      where: { username: receiver.username },
      create: { id: receiver.id, username: receiver.username, passwordHash: receiverHash, role: 'user', status: 'active' },
      update: { passwordHash: receiverHash, role: 'user', status: 'active' },
    })
    for (const probe of [sender, receiver]) {
      await tx.personalProfile.upsert({ where: { userId: probe.id }, create: { userId: probe.id }, update: {} })
      await tx.chatPrivacySetting.upsert({
        where: { userId: probe.id },
        create: { userId: probe.id, allowExactUsernameDiscovery: false },
        update: { allowExactUsernameDiscovery: false },
      })
    }
    const businessLinks = await Promise.all([
      tx.organizationMembership.count({ where: { userId: { in: [sender.id, receiver.id] } } }),
      tx.teamMember.count({ where: { userId: { in: [sender.id, receiver.id] } } }),
    ])
    if (businessLinks.some(Boolean)) throw new Error('Probe accounts must not have organization or team relationships')
    const [userLowId, userHighId] = [sender.id, receiver.id].sort()
    await tx.friendship.upsert({
      where: { userLowId_userHighId: { userLowId, userHighId } },
      create: { id: 'system-chat-probe-friendship', userLowId, userHighId, status: 'active' },
      update: { status: 'active', removedAt: null, removedById: null, acceptedAt: new Date() },
    })
    const conversation = await tx.directConversation.upsert({
      where: { userLowId_userHighId: { userLowId, userHighId } },
      create: { id: 'system-chat-probe-conversation', userLowId, userHighId },
      update: {},
    })
    for (const probe of [sender, receiver]) {
      await tx.directConversationMember.upsert({
        where: { conversationId_userId: { conversationId: conversation.id, userId: probe.id } },
        create: { id: `system-chat-probe-member-${probe.id === sender.id ? 'sender' : 'receiver'}`, conversationId: conversation.id, userId: probe.id },
        update: { archivedAt: null },
      })
    }
    return { conversationId: conversation.id, userIds: [sender.id, receiver.id] }
  })
  console.log(JSON.stringify({ apply: true, ...result }))
}

main().finally(() => prisma.$disconnect()).catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
