'use client'

import { Paperclip } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/FormControls'
import collisionStyles from './ProblemForm.collision.module.css'
import unifiedStyles from './ProblemForm.unified.module.css'

type Attachment = { id: string; fileName: string; fileSize: number }
type RemoteAttachment = { filename: string; downloadLink: string }

type Props = {
  attachments: Attachment[]
  remoteAttachments: RemoteAttachment[]
  loading: boolean
  uploading: boolean
  downloadingFilename: string | null
  onUpload: (event: React.ChangeEvent<HTMLInputElement>) => void
  onDelete: (id: string) => void
  onDownloadRemote: (attachment: RemoteAttachment) => void
}

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ProblemAttachments({
  attachments,
  remoteAttachments,
  loading,
  uploading,
  downloadingFilename,
  onUpload,
  onDelete,
  onDownloadRemote,
}: Props) {
  return (
    <div>
      <div className={unifiedStyles.u37}>
        <label className={unifiedStyles.u8}>上传附件</label>
        <p className={unifiedStyles.u32}>
          支持 PDF、ZIP、RAR、7Z、TXT、CPP、C、PY、JAVA、PAS、IN、OUT、MD 格式，最大 50MB
        </p>
        <Input
          type="file"
          accept=".pdf,.zip,.rar,.7z,.txt,.cpp,.c,.py,.java,.pas,.in,.out,.md"
          onChange={onUpload}
          disabled={uploading}
          className={unifiedStyles.u24}
        />
        {uploading && <span className={unifiedStyles.u38}>上传中...</span>}
      </div>
      <div className={unifiedStyles.u39}>
        <label className={unifiedStyles.u8}>已上传附件</label>
        {loading ? (
          <div className={unifiedStyles.u40}>
            <span className={['resource-skeleton-line', collisionStyles.u2].join(' ')} aria-label="内容正在准备" />
          </div>
        ) : attachments.length === 0 ? (
          <div className={unifiedStyles.u40}>暂无附件</div>
        ) : (
          <div>
            {attachments.map((attachment) => (
              <div key={attachment.id} className={unifiedStyles.u41}>
                <div className={unifiedStyles.u16}>
                  <Paperclip aria-hidden="true" size={20} />
                  <div>
                    <div className={unifiedStyles.u15}>{attachment.fileName}</div>
                    <div className={unifiedStyles.u10}>{formatFileSize(attachment.fileSize)}</div>
                  </div>
                </div>
                <Button variant="outline" size="sm" type="button" onClick={() => onDelete(attachment.id)} className={unifiedStyles.u42}>
                  删除
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
      {remoteAttachments.length > 0 && (
        <div className={unifiedStyles.u39}>
          <label className={unifiedStyles.u8}>远程附件（从 OJ 拉取）</label>
          <p className={unifiedStyles.u32}>以下附件来自 OJ 平台，点击下载后保存到本系统</p>
          <div>
            {remoteAttachments.map((attachment) => (
              <div key={`${attachment.filename}-${attachment.downloadLink}`} className={unifiedStyles.u43}>
                <div className={unifiedStyles.u16}>
                  <span className={unifiedStyles.u44} aria-hidden="true">📥</span>
                  <div>
                    <div className={unifiedStyles.u15}>{attachment.filename}</div>
                    <div className={unifiedStyles.u10}>待下载</div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => onDownloadRemote(attachment)}
                  disabled={downloadingFilename !== null}
                >
                  {downloadingFilename === attachment.filename ? '下载中...' : '下载'}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
