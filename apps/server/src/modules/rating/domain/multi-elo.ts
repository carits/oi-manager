export const RATING_ALGORITHM = { code: 'CARITS_MULTI_ELO', version: 1 } as const

export interface EloParticipant {
  userId: string
  rating: number
  tieGroup: string
  rank: number
}

export interface EloChange {
  userId: string
  ratingBefore: number
  expectedPerformance: number
  actualPerformance: number
  rawDelta: number
  appliedDelta: number
  ratingAfter: number
  rank: number
}

function winProbability(left: number, right: number, scale: number) {
  return 1 / (1 + 10 ** ((right - left) / scale))
}

/** Largest-remainder rounding preserves the zero-sum property of one batch. */
export function balancedRound(values: number[], target = Math.round(values.reduce((sum, value) => sum + value, 0))) {
  const rounded = values.map(Math.floor)
  let remaining = target - rounded.reduce((sum, value) => sum + value, 0)
  const order = values.map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction || left.index - right.index)
  for (let index = 0; index < order.length && remaining > 0; index++, remaining--) rounded[order[index].index]++
  return rounded
}

export function calculateMultiElo(
  participants: EloParticipant[],
  options: { scale?: number; kFactor?: number; weightBasisPoints?: number } = {},
): EloChange[] {
  if (participants.length < 2) return participants.map(item => ({
    userId: item.userId, ratingBefore: item.rating, expectedPerformance: 0.5,
    actualPerformance: 0.5, rawDelta: 0, appliedDelta: 0,
    ratingAfter: item.rating, rank: item.rank,
  }))
  const scale = options.scale ?? 400
  const kFactor = options.kFactor ?? 96
  const weight = (options.weightBasisPoints ?? 10_000) / 10_000
  const provisional = participants.map((participant, index) => {
    let expected = 0
    let actual = 0
    for (let opponentIndex = 0; opponentIndex < participants.length; opponentIndex++) {
      if (opponentIndex === index) continue
      const opponent = participants[opponentIndex]
      expected += winProbability(participant.rating, opponent.rating, scale)
      actual += participant.tieGroup === opponent.tieGroup ? 0.5 : participant.rank < opponent.rank ? 1 : 0
    }
    expected /= participants.length - 1
    actual /= participants.length - 1
    return { participant, expected, actual, raw: kFactor * weight * (actual - expected) }
  })
  const applied = balancedRound(provisional.map(item => item.raw), 0)
  return provisional.map((item, index) => ({
    userId: item.participant.userId,
    ratingBefore: item.participant.rating,
    expectedPerformance: item.expected,
    actualPerformance: item.actual,
    rawDelta: item.raw,
    appliedDelta: applied[index],
    ratingAfter: item.participant.rating + applied[index],
    rank: item.participant.rank,
  }))
}
