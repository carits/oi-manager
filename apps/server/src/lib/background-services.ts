import { startCronTasks } from './cron-tasks'
import { startAutoVerifyScheduler } from '../modules/oj-account/application/oj-account.service'
import logger from './logger'
import {
  listPendingOjFetchPlatforms,
  recoverStaleOjFetchJobs,
} from '../modules/oj-fetcher/application/oj-fetcher-queue.service'

export interface BackgroundServicesHandle {
  stop(): Promise<void>
}

export function startOjFetchQueueScheduler(intervalMs = 2_000): () => Promise<void> {
  let stopped = false
  let running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const recovered = await recoverStaleOjFetchJobs()
      if (recovered) logger.warn('oj_fetch_queue_stale_jobs_recovered', { action: 'oj_fetch', metadata: { recovered } })
      const platforms = await listPendingOjFetchPlatforms()
      if (!platforms.length) return
      const { processOjFetchQueue } = await import('../modules/oj-fetcher/application/oj-fetcher-worker.service')
      await Promise.all(platforms.map(platform => processOjFetchQueue(platform)))
    } catch (error) {
      logger.error('oj_fetch_queue_tick_failed', error, { action: 'oj_fetch' })
    } finally {
      running = false
    }
  }
  let inFlight: Promise<void> | null = null
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => { inFlight = null })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref()
  run()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

export function startTrainingEngineScheduler(intervalMs = 5_000): () => Promise<void> {
  let stopped = false, running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const { processDueTrainingSessions } = await import('../modules/training-engine/training-engine.service')
      const result = await processDueTrainingSessions()
      if (result.started || result.advanced || result.ended) logger.info('training_engine_scheduler_tick', { action: 'training_engine', metadata: result })
    } catch (error) {
      logger.error('training_engine_scheduler_failed', error, { action: 'training_engine' })
    } finally { running = false }
  }
  let inFlight: Promise<void> | null = null
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => { inFlight = null })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref()
  run()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

export function startAssignmentScheduler(intervalMs = 5_000): () => Promise<void> {
  let stopped = false, running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const { processDueAssignments } = await import('../modules/assignment/assignment.service')
      const result = await processDueAssignments()
      if (result.opened || result.overdue || result.closed) logger.info('assignment_scheduler_tick', { action: 'assignment', metadata: result })
    } catch (error) { logger.error('assignment_scheduler_failed', error, { action: 'assignment' }) }
    finally { running = false }
  }
  let inFlight: Promise<void> | null = null
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => { inFlight = null })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref(); run()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

export function startContributionRewardScheduler(intervalMs = 5_000): () => Promise<void> {
  let stopped = false, running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const { processContributionRewardDeliveries } = await import('../modules/contribution/application/contribution-reward.service')
      const result = await processContributionRewardDeliveries()
      if (result.posted) logger.info('contribution_rewards_posted', { action: 'contribution_reward', metadata: result })
    } catch (error) { logger.error('contribution_reward_scheduler_failed', error, { action: 'contribution_reward' }) }
    finally { running = false }
  }
  let inFlight: Promise<void> | null = null
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => { inFlight = null })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref(); run()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

export function startEvaluationReservationReconciler(intervalMs = 30_000): () => Promise<void> {
  let stopped = false, running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const { reconcileEvaluationCreditReservations } = await import('../modules/problem/problem.evaluation-budget.service')
      const result = await reconcileEvaluationCreditReservations()
      if (result.settled || result.released || result.failed) logger.info('evaluation_reservations_reconciled', { action: 'evaluation_budget', metadata: result })
    } catch (error) { logger.error('evaluation_reservation_reconciler_failed', error, { action: 'evaluation_budget' }) }
    finally { running = false }
  }
  let inFlight: Promise<void> | null = null
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => { inFlight = null })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref(); run()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

export function startContestRatingScheduler(intervalMs = 10_000): () => Promise<void> {
  let stopped = false, running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const { processDueContestRatings } = await import('../modules/rating/application/contest-rating.service')
      const result = await processDueContestRatings()
      if (result.finalized || result.failed) logger.info('contest_rating_scheduler_tick', { action: 'rating', metadata: result })
    } catch (error) { logger.error('contest_rating_scheduler_failed', error, { action: 'rating' }) }
    finally { running = false }
  }
  let inFlight: Promise<void> | null = null
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => { inFlight = null })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref(); run()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

export function startQualityEvaluationScheduler(intervalMs = 5_000): () => Promise<void> {
  let stopped = false, running = false
  let staleSweepTicks = 0
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const { processQualityEvaluationJobs, enqueueStaleQualityEvaluations } = await import('../modules/problem/problem.quality.service')
      const result = await processQualityEvaluationJobs(2)
      if (result.processed || result.failed) logger.info('quality_evaluation_scheduler_tick', { action: 'quality_evaluation', metadata: result })
      staleSweepTicks++
      if (staleSweepTicks >= 12) {
        staleSweepTicks = 0
        const sweep = await enqueueStaleQualityEvaluations(20)
        if (sweep.queued) logger.info('quality_evaluation_stale_sweep', { action: 'quality_evaluation', metadata: sweep })
      }
    } catch (error) { logger.error('quality_evaluation_scheduler_failed', error, { action: 'quality_evaluation' }) }
    finally { running = false }
  }
  let inFlight: Promise<void> | null = null
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => { inFlight = null })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref(); run()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

export function startSolutionSimilarityScheduler(intervalMs = 2_000): () => Promise<void> {
  let stopped = false, running = false
  const tick = async () => {
    if (stopped || running) return
    running = true
    try {
      const { processSolutionSimilarityJobs } = await import('../modules/solution/solution.service')
      const result = await processSolutionSimilarityJobs(2)
      if (result.processed) logger.info('solution_similarity_scheduler_tick', { action: 'solution_similarity', metadata: result })
    } catch (error) { logger.error('solution_similarity_scheduler_failed', error, { action: 'solution_similarity' }) }
    finally { running = false }
  }
  let inFlight: Promise<void> | null = null
  const run = () => {
    if (stopped || inFlight) return
    inFlight = tick().finally(() => { inFlight = null })
  }
  const timer = setInterval(run, intervalMs)
  timer.unref(); run()
  return async () => {
    stopped = true
    clearInterval(timer)
    await inFlight
  }
}

export function startSchedulerServices(): BackgroundServicesHandle {
  const stopCronTasks = startCronTasks()
  const stopAutoVerify = startAutoVerifyScheduler()
  const stopOjFetchQueue = startOjFetchQueueScheduler()
  const stopTrainingEngine = startTrainingEngineScheduler()
  const stopAssignments = startAssignmentScheduler()
  const stopContributionRewards = startContributionRewardScheduler()
  const stopEvaluationReservations = startEvaluationReservationReconciler()
  const stopContestRatings = startContestRatingScheduler()
  const stopQualityEvaluations = startQualityEvaluationScheduler()
  const stopSolutionSimilarities = startSolutionSimilarityScheduler()
  logger.info('scheduler_services_started', { action: 'background_scheduler' })

  let stopped = false
  return {
    async stop() {
      if (stopped) return
      stopped = true
      await Promise.all([
        stopOjFetchQueue(),
        stopTrainingEngine(),
        stopAssignments(),
        stopContributionRewards(),
        stopEvaluationReservations(),
        stopContestRatings(),
        stopQualityEvaluations(),
        stopSolutionSimilarities(),
      ])
      stopAutoVerify()
      stopCronTasks()
      logger.info('scheduler_services_stopped', { action: 'background_scheduler' })
    },
  }
}

export function startExecutorServices(): BackgroundServicesHandle {
  logger.info('executor_services_started', { action: 'background_executor' })
  let stopped = false
  return {
    async stop() {
      if (stopped) return
      stopped = true
      logger.info('executor_services_stopped', { action: 'background_executor' })
    },
  }
}

/** Compatibility composition for isolated tests and one-process development. */
export function startBackgroundServices(): BackgroundServicesHandle {
  const scheduler = startSchedulerServices()
  const executor = startExecutorServices()
  return { async stop() { await executor.stop(); await scheduler.stop() } }
}
