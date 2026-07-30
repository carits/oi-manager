export function getClientHeartbeatReply(
  type: unknown,
): 'pong' | null | undefined {
  if (type === 'ping') return 'pong'
  if (type === 'pong') return null
  return undefined
}
