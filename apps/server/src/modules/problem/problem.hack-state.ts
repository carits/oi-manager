export const HACK_ATTEMPT_STATES = [
  'queuing',
  'judging',
  'finalizing',
  'accepted',
  'rejected',
  'system_error',
  'stale',
] as const

export type HackAttemptState = typeof HACK_ATTEMPT_STATES[number]

export const HACK_ATTEMPT_TRANSITIONS: Readonly<Record<HackAttemptState, readonly HackAttemptState[]>> = {
  queuing: ['judging', 'stale'],
  judging: ['finalizing', 'queuing'],
  finalizing: ['accepted', 'rejected', 'system_error', 'stale', 'queuing'],
  accepted: [],
  rejected: [],
  system_error: ['queuing'],
  stale: [],
}

export class InvalidHackTransition extends Error {
  constructor(from: string, to: string) {
    super(`ProblemHackAttempt cannot transition from ${from} to ${to}`)
    this.name = 'InvalidHackTransition'
  }
}

export function assertHackTransition(from: HackAttemptState, to: HackAttemptState) {
  if (!HACK_ATTEMPT_TRANSITIONS[from].includes(to)) throw new InvalidHackTransition(from, to)
}

interface HackAttemptDelegate {
  updateMany(args: Record<string, unknown>): Promise<{ count: number }>
}

interface HackPersistence {
  problemHackAttempt: HackAttemptDelegate
}

export async function transitionHackAttempt(
  db: HackPersistence,
  input: {
    id: string
    from: HackAttemptState
    to: HackAttemptState
    judgeId?: string
    data?: Record<string, unknown>
  },
) {
  assertHackTransition(input.from, input.to)
  return db.problemHackAttempt.updateMany({
    where: {
      id: input.id,
      status: input.from,
      ...(input.judgeId ? { judgeId: input.judgeId } : {}),
    },
    data: { ...input.data, status: input.to },
  })
}

export async function transitionHackAttempts(
  db: HackPersistence,
  input: {
    from: readonly HackAttemptState[]
    to: HackAttemptState
    where?: Record<string, unknown>
    data?: Record<string, unknown>
  },
) {
  for (const from of input.from) assertHackTransition(from, input.to)
  return db.problemHackAttempt.updateMany({
    where: { ...input.where, status: { in: [...input.from] } },
    data: { ...input.data, status: input.to },
  })
}
