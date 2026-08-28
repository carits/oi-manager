import { getAdapter, fetchProblemWithMetrics, OjFetchError } from '../../../oj-adapters'
import { fileService } from '../../../lib/storage'
import logger from '../../../lib/logger'
import {
  claimNextOjFetchJob,
  completeOjFetchJob,
  failOjFetchJob,
  getOjFetchCookies,
  getProblemStatementsForImageProcessing,
  persistFetchedProblem,
  updateFetchedProblemDescription,
  updateFetchedStatementContent,
} from './oj-fetcher-queue.service'
import {
  downloadAndStoreProblemAsset,
  extractImageLinks,
  processMarkdownImages,
} from './oj-fetcher-remote-assets.service'

export async function processOjFetchQueue(platform: string) {
  const cookies = await getOjFetchCookies(platform)
  while (true) {
    const job = await claimNextOjFetchJob(platform)
    if (!job) return
    try {
      const adapter = getAdapter(platform as any)
      if (!adapter.isValidProblemId(job.problemId)) {
        await failOjFetchJob(job.id, `无效的题号格式: ${job.problemId}`)
        continue
      }
      const problemData = await fetchProblemWithMetrics(platform as any, job.problemId)
      const persisted = await persistFetchedProblem(platform, job.problemId, problemData)
      for (const imageId of persisted.oldImageIds) await fileService.hardDelete(imageId).catch(() => {})

      let description = problemData.description || ''
      if (description) description = await processMarkdownImages(persisted.problemId, description, cookies, platform)
      let attachmentFailed = false
      for (const attachment of problemData.attachments || []) {
        try {
          const stored = await downloadAndStoreProblemAsset({
            problemId: persisted.problemId,
            url: attachment.downloadLink,
            filename: attachment.filename,
            cookies,
            platform,
          })
          description = description.split(attachment.downloadLink).join(stored.file.fileUrl)
        } catch (error) {
          attachmentFailed = true
          logger.error('oj_fetcher_attachment_download_failed', error, {
            action: 'oj_fetch', metadata: { jobId: job.id, filename: attachment.filename },
          })
        }
      }
      if (description !== problemData.description) {
        await updateFetchedProblemDescription(persisted.problemId, description)
      }
      const statements = await getProblemStatementsForImageProcessing(persisted.problemId)
      for (const statement of statements) {
        if (!statement.content || !extractImageLinks(statement.content).length) continue
        const content = await processMarkdownImages(persisted.problemId, statement.content, cookies, platform)
        if (content !== statement.content) await updateFetchedStatementContent(statement.id, content)
      }
      const hasAttachments = Boolean(problemData.attachments?.length)
      await completeOjFetchJob(
        job.id, persisted.problemId, hasAttachments,
        hasAttachments ? (attachmentFailed ? 'failed' : 'success') : null,
        attachmentFailed ? '部分附件下载失败' : null,
      )
    } catch (error) {
      logger.error('oj_fetcher_job_failed', error, { action: 'oj_fetch', metadata: { jobId: job.id, platform } })
      await failOjFetchJob(job.id, error instanceof OjFetchError ? error.message : '拉取失败')
    }
    await new Promise(resolve => setTimeout(resolve, 2_000))
  }
}
