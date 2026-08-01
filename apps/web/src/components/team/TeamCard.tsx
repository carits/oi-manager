import Link from 'next/link'
import { Crown, LockKeyhole, Users } from 'lucide-react'
import { getAssetUrl } from '@/lib/assets'
import styles from './Team.module.css'

export interface TeamCardProps {
  id: string
  name: string
  avatar?: string | null
  description?: string | null
  memberCount: number
  schoolName?: string
  ownerName?: string
  isPublic?: boolean
  basePath?: string
}

export function TeamCard({ id, name, avatar, description, memberCount, schoolName, ownerName, isPublic, basePath = '/teacher/teams' }: TeamCardProps) {
  return (
    <Link href={`${basePath}/${id}`} className={styles.teamCard}>
      <div className={styles.teamCardHeader}>
        <span className={styles.teamAvatar}>{avatar ? <img src={getAssetUrl(avatar)} alt="" /> : name.charAt(0)}</span>
        <span className={styles.teamHeading}><span className={styles.teamName}>{name}</span><span className={styles.teamSchool}>{schoolName || '个人团队'}</span></span>
      </div>
      <p className={styles.teamDescription}>{description || '暂无团队说明'}</p>
      <div className={styles.teamMeta}>
        <span className={styles.metaItem}><Users size={14} aria-hidden="true" />{memberCount} 人</span>
        {ownerName && <span className={styles.metaItem}><Crown size={14} aria-hidden="true" />{ownerName}</span>}
        {isPublic === false && <span className={`${styles.metaItem} ${styles.private}`}><LockKeyhole size={14} aria-hidden="true" />私有</span>}
      </div>
    </Link>
  )
}
