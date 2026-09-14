'use client'

import { Button } from '@/components/ui/Button'
import { Input, Select } from '@/components/ui/FormControls'
import { OJ_PLATFORMS_NO_ALL as OJ_PLATFORMS } from '@/lib/oj-platforms'
import unifiedStyles from './ProblemForm.unified.module.css'

export type ProblemOjBinding = { platform: string; problemId: string; url?: string }

type Props = {
  role: 'teacher' | 'student' | 'admin'
  status: string
  bindings: ProblemOjBinding[]
  fetching: boolean
  onStatusChange: (value: string) => void
  onBindingChange: (index: number, field: 'platform' | 'problemId', value: string) => void
  onFetch: (index: number) => void
  onRemove: (index: number) => void
  onAdd: () => void
}

export function ProblemPublishingSettings({
  role,
  status,
  bindings,
  fetching,
  onStatusChange,
  onBindingChange,
  onFetch,
  onRemove,
  onAdd,
}: Props) {
  return (
    <div>
      {role === 'admin' && (
        <div className={unifiedStyles.u30}>
          <label className={unifiedStyles.u8}>题库归属</label>
          <p className={unifiedStyles.u31}>平台题库</p>
        </div>
      )}
      <div className={unifiedStyles.u30}>
        <label className={unifiedStyles.u8}>状态</label>
        <Select
          aria-label="选择题目状态"
          value={status}
          onChange={(event) => onStatusChange(event.target.value)}
          className={unifiedStyles.u28}
        >
          <option value="draft">草稿</option>
          <option value="published">已发布</option>
        </Select>
      </div>
      <div className={unifiedStyles.u30}>
        <label className={unifiedStyles.u8}>OJ 题目绑定</label>
        <p className={unifiedStyles.u32}>绑定外部 OJ 题目，最多可添加 3 个</p>
        {bindings.map((binding, index) => (
          <div key={`${binding.platform}-${binding.problemId}-${index}`} className={unifiedStyles.u33}>
            <Select
              aria-label="选择 OJ 平台"
              value={binding.platform}
              onChange={(event) => onBindingChange(index, 'platform', event.target.value)}
              className={unifiedStyles.u28}
            >
              <option value="">选择平台</option>
              {OJ_PLATFORMS.map((platform) => (
                <option key={platform.value} value={platform.value}>{platform.label}</option>
              ))}
            </Select>
            <Input
              type="text"
              value={binding.problemId}
              onChange={(event) => onBindingChange(index, 'problemId', event.target.value)}
              placeholder="题号"
              className={unifiedStyles.u34}
            />
            <Button
              variant="outline"
              type="button"
              onClick={() => onFetch(index)}
              disabled={fetching || !binding.platform || !binding.problemId.trim()}
              size="sm"
            >
              {fetching ? '拉取中...' : '拉取'}
            </Button>
            <Button variant="ghost" type="button" onClick={() => onRemove(index)} className={unifiedStyles.u35}>
              删除
            </Button>
          </div>
        ))}
        {bindings.length < 3 && (
          <Button variant="ghost" type="button" onClick={onAdd} className={unifiedStyles.u36}>
            + 添加绑定
          </Button>
        )}
      </div>
    </div>
  )
}
