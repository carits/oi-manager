import crypto from 'crypto'
import { prisma } from '../../prisma'

const MAX_MARKDOWN_BYTES = 1024 * 1024

export class ContentSnapshotEditError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message)
  }
}

function validateMarkdown(content: string) {
  if (!content.trim()) throw new ContentSnapshotEditError('内容不能为空')
  if (Buffer.byteLength(content, 'utf8') > MAX_MARKDOWN_BYTES) {
    throw new ContentSnapshotEditError('Markdown 内容不能超过 1MB')
  }
}

export async function editActivityContentSnapshot(input: {
  trainingProblemId: string
  kind: 'statement' | 'solution'
  snapshotId: string
  selectedBy: string
  mode: 'markdown' | 'pdf'
  content?: string
  fileId?: string
  fileName?: string
}) {
  if (input.kind === 'statement') {
    const current = await prisma.trainingProblemStatementSet.findFirst({
      where: { trainingProblemId: input.trainingProblemId },
      orderBy: { revision: 'desc' },
      include: { Snapshot: { orderBy: { orderIndex: 'asc' } } },
    })
    const target = current?.Snapshot.find(item => item.id === input.snapshotId)
    if (!current || !target) {
      throw new ContentSnapshotEditError('题面已经更新，请刷新后重试', 409, 'CONTENT_SNAPSHOT_STALE')
    }
    if (target.format !== input.mode) {
      throw new ContentSnapshotEditError(input.mode === 'markdown' ? 'PDF 题面不能使用 Markdown 编辑器修改' : 'Markdown 题面不能直接替换为 PDF')
    }
    if (input.mode === 'markdown') validateMarkdown(input.content || '')
    if (input.mode === 'pdf' && !input.fileId) throw new ContentSnapshotEditError('请选择 PDF 文件')

    return prisma.$transaction(async tx => {
      const latest = await tx.trainingProblemStatementSet.findFirst({
        where: { trainingProblemId: input.trainingProblemId }, orderBy: { revision: 'desc' }, select: { id: true },
      })
      if (latest?.id !== current.id) {
        throw new ContentSnapshotEditError('题面已经更新，请刷新后重试', 409, 'CONTENT_SNAPSHOT_STALE')
      }
      const set = await tx.trainingProblemStatementSet.create({ data: {
        id: crypto.randomUUID(), trainingProblemId: input.trainingProblemId,
        revision: current.revision + 1, selectedBy: input.selectedBy,
      } })
      let editedSnapshotId = ''
      for (const snapshot of current.Snapshot) {
        const edited = snapshot.id === target.id
        const id = crypto.randomUUID()
        if (edited) editedSnapshotId = id
        await tx.trainingProblemStatementSnapshot.create({ data: {
          id, statementSetId: set.id,
          sourceType: edited ? 'training' : snapshot.sourceType,
          sourceContentId: edited ? snapshot.id : snapshot.sourceContentId,
          name: snapshot.name, title: snapshot.title, language: snapshot.language, format: snapshot.format,
          content: edited && input.mode === 'markdown' ? input.content! : edited ? null : snapshot.content,
          snapshotFileId: edited && input.mode === 'pdf' ? input.fileId! : edited ? null : snapshot.snapshotFileId,
          fileName: edited && input.mode === 'pdf' ? input.fileName || snapshot.fileName : snapshot.fileName,
          authorUserId: snapshot.authorUserId, authorUsernameSnapshot: snapshot.authorUsernameSnapshot,
          isDefault: snapshot.isDefault, orderIndex: snapshot.orderIndex,
        } })
      }
      return { revision: set.revision, snapshotId: editedSnapshotId }
    })
  }

  const current = await prisma.trainingProblemContentSnapshot.findFirst({
    where: { trainingProblemId: input.trainingProblemId, kind: 'solution' },
    orderBy: [{ revision: 'desc' }, { selectedAt: 'desc' }],
  })
  if (!current || current.id !== input.snapshotId) {
    throw new ContentSnapshotEditError('题解已经更新，请刷新后重试', 409, 'CONTENT_SNAPSHOT_STALE')
  }
  if (current.sourceType === 'none') throw new ContentSnapshotEditError('当前活动未选择题解')
  if (current.format !== input.mode) {
    throw new ContentSnapshotEditError(input.mode === 'markdown' ? 'PDF 题解不能使用 Markdown 编辑器修改' : 'Markdown 题解不能直接替换为 PDF')
  }
  if (input.mode === 'markdown') validateMarkdown(input.content || '')
  if (input.mode === 'pdf' && !input.fileId) throw new ContentSnapshotEditError('请选择 PDF 文件')

  return prisma.$transaction(async tx => {
    const latest = await tx.trainingProblemContentSnapshot.findFirst({
      where: { trainingProblemId: input.trainingProblemId, kind: 'solution' },
      orderBy: [{ revision: 'desc' }, { selectedAt: 'desc' }], select: { id: true },
    })
    if (latest?.id !== current.id) {
      throw new ContentSnapshotEditError('题解已经更新，请刷新后重试', 409, 'CONTENT_SNAPSHOT_STALE')
    }
    const created = await tx.trainingProblemContentSnapshot.create({ data: {
      id: crypto.randomUUID(), trainingProblemId: input.trainingProblemId, kind: 'solution',
      revision: current.revision + 1, sourceType: 'training', sourceContentId: current.id,
      sourceRevision: current.revision, format: current.format, language: current.language, title: current.title,
      content: input.mode === 'markdown' ? input.content! : null,
      snapshotFileId: input.mode === 'pdf' ? input.fileId! : null,
      fileName: input.mode === 'pdf' ? input.fileName || current.fileName : current.fileName,
      authorUserId: current.authorUserId, authorUsernameSnapshot: current.authorUsernameSnapshot,
      selectedBy: input.selectedBy,
    } })
    return { revision: created.revision, snapshotId: created.id }
  })
}
