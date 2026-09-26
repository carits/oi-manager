export type TrainingDraftSnapshot = {
  code: string
  language: string
  inputFilename: string | null
  outputFilename: string | null
}

export type TrainingDraftResolution =
  | { type: 'remote'; draft: TrainingDraftSnapshot }
  | { type: 'conflict'; local: TrainingDraftSnapshot; remote: TrainingDraftSnapshot }

function sameDraft(left: TrainingDraftSnapshot, right: TrainingDraftSnapshot) {
  return left.code === right.code
    && left.language === right.language
    && left.inputFilename === right.inputFilename
    && left.outputFilename === right.outputFilename
}

export function arbitrateTrainingDraft(local: TrainingDraftSnapshot, remote: TrainingDraftSnapshot, localDirty: boolean): TrainingDraftResolution {
  if (localDirty && !sameDraft(local, remote)) return { type: 'conflict', local, remote }
  return { type: 'remote', draft: remote }
}
