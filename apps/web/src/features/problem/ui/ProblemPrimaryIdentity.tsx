'use client'

import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL, getOjPlatformLabel } from '@/lib/oj-platforms'
import styles from './ProblemForm.unified.module.css'

export type ProblemPrimaryIdentityValue = { platform: string; problemId: string }

type Props = {
  current: ProblemPrimaryIdentityValue
  value: ProblemPrimaryIdentityValue
  editing: boolean
  editable: boolean
  disabled: boolean
  stable: boolean
  published: boolean
  onEditing: (editing: boolean) => void
  onChange: (value: ProblemPrimaryIdentityValue) => void
}

export function ProblemPrimaryIdentity({ current, value, editing, editable, disabled, stable, published, onEditing, onChange }: Props) {
  return <section className={styles.u30} aria-label="题目主身份">
    <strong>{getOjPlatformLabel(current.platform)} · {current.problemId}</strong>
    <p className={styles.u32}>{published ? '已发布' : '未发布'} · {stable ? '已有 Stable 数据槽，正式使用仍需业务校验' : '尚无 Stable 评测数据'}。仅通过主 OJ 和主题号检索。</p>
    {editable && <Button type="button" variant="outline" disabled={disabled} onClick={() => { onChange(current); onEditing(!editing) }}>
      {editing ? '取消主身份修改' : '修改草稿主身份'}
    </Button>}
    {!editable && <p className={styles.u32}>已发布或被业务引用的主身份不可在普通编辑中修改。</p>}
    {editing && <div className={styles.u33}>
      <Select aria-label="主 OJ" value={value.platform} disabled={disabled} onChange={event => onChange({ ...value, platform: event.target.value })}>
        {!OJ_PLATFORMS_NO_ALL.some(item => item.value === value.platform) && <option value={value.platform}>{getOjPlatformLabel(value.platform)}（历史标识）</option>}
        {OJ_PLATFORMS_NO_ALL.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
      </Select>
      <Input aria-label="主题号" value={value.problemId} disabled={disabled} onChange={event => onChange({ ...value, problemId: event.target.value })} />
      <span className={styles.u32}>显式修改将在保存时校验；题号区分大小写，附加来源不会改变主身份。</span>
    </div>}
  </section>
}
