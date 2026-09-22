import { TrainingEngineError } from './training-engine.errors'

export type TrainingCommandHandler = () => Promise<void>

export class TrainingCommandDispatcher {
  constructor(private readonly handlers: Record<string, TrainingCommandHandler>) {}

  supports(type: string) {
    return Boolean(this.handlers[type])
  }

  async dispatch(type: string) {
    const handler = this.handlers[type]
    if (!handler) throw new TrainingEngineError(422, 'UNKNOWN_TRAINING_COMMAND', `不支持的教练命令：${type}`)
    await handler()
  }
}

export function createTrainingCommandDispatcher(handlers: Record<string, TrainingCommandHandler>) {
  return new TrainingCommandDispatcher(handlers)
}
