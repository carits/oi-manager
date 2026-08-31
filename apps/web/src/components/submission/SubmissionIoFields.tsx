'use client'

import { Input, Select } from '@/components/ui/FormControls'
import styles from './SubmissionIoFields.module.css'

export interface SubmissionIoValue {
  inputFilename: string | null
  outputFilename: string | null
}

export function SubmissionIoFields({ value, onChange, legacySuggested = false }: {
  value: SubmissionIoValue
  onChange: (value: SubmissionIoValue) => void
  legacySuggested?: boolean
}) {
  return <section className={styles.root} aria-label="程序输入输出方式">
    <div className={styles.header}>
      <strong>程序输入输出</strong>
      {legacySuggested && <span>由旧题配置带入，可修改</span>}
    </div>
    <div className={styles.grid}>
      <label className={styles.field}>
        <span>输入方式</span>
        <Select value={value.inputFilename !== null ? 'file' : 'standard'} onChange={event => onChange({ ...value, inputFilename: event.target.value === 'file' ? value.inputFilename || '' : null })}>
          <option value="standard">标准输入 stdin</option>
          <option value="file">文件输入</option>
        </Select>
        {value.inputFilename !== null && <Input aria-label="输入文件名" placeholder="例如 travel.in" maxLength={128} value={value.inputFilename} onChange={event => onChange({ ...value, inputFilename: event.target.value })} />}
      </label>
      <label className={styles.field}>
        <span>输出方式</span>
        <Select value={value.outputFilename !== null ? 'file' : 'standard'} onChange={event => onChange({ ...value, outputFilename: event.target.value === 'file' ? value.outputFilename || '' : null })}>
          <option value="standard">标准输出 stdout</option>
          <option value="file">文件输出</option>
        </Select>
        {value.outputFilename !== null && <Input aria-label="输出文件名" placeholder="例如 travel.out" maxLength={128} value={value.outputFilename} onChange={event => onChange({ ...value, outputFilename: event.target.value })} />}
      </label>
    </div>
    <p className={styles.hint}>文件名只能包含字母、数字、点、下划线和连字符；不支持目录或自动识别 freopen。</p>
  </section>
}
