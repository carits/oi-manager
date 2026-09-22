export const TrainingEventTypes = {
  SESSION_SCHEDULED: 'training.session.scheduled',
  SESSION_STARTED: 'training.session.started',
  SESSION_PAUSED: 'training.session.paused',
  SESSION_RESUMED: 'training.session.resumed',
  SESSION_ENDED: 'training.session.ended',

  STAGE_STARTED: 'training.stage.started',
  STAGE_ENDED: 'training.stage.ended',
  STAGE_SKIPPED: 'training.stage.skipped',
  STAGE_ADVANCED: 'training.stage.advanced',
  STAGE_GROUP_CHANGED: 'training.stage.group_changed',
  STAGE_TIME_EXTENDED: 'training.stage.time_extended',

  PROBLEM_UNLOCKED: 'training.problem.unlocked',
  PROBLEM_SKIPPED: 'training.problem.skipped',
  PROBLEM_STUCK: 'training.problem.stuck',
  PROBLEM_STUCK_CLEARED: 'training.problem.stuck_cleared',
  PROGRESS_UPDATED: 'training.progress.updated',

  HINT_OPENED: 'training.hint.opened',
  MESSAGE_SHOWN: 'training.message.shown',

  ROSTER_UPDATED: 'training.roster.updated',
  OVERLAY_EXPIRED: 'training.overlay.expired',
} as const

export type TrainingEventType = typeof TrainingEventTypes[keyof typeof TrainingEventTypes]
