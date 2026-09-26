export type TrainingDesignParticipant = {
  id: string
  userId: string
  status: string
}

export function flattenTrainingDesignParticipants(
  groups: Array<{ id: string; Participants: TrainingDesignParticipant[] }>,
) {
  return groups.flatMap(group =>
    group.Participants.map(participant => ({
      ...participant,
      groupId: group.id,
    })),
  )
}
