export interface HeartbeatAction {
  handled: boolean
  reply?: 'pong'
}

export function getHeartbeatAction(type: unknown): HeartbeatAction {
  if (type === 'ping') return { handled: true, reply: 'pong' }
  if (type === 'pong') return { handled: true }
  return { handled: false }
}
