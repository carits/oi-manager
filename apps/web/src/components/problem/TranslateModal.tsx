'use client'

import { useState } from 'react'
import unifiedStyles from './TranslateModal.unified.module.css'
import { Input, Select, Textarea } from '@/components/ui/FormControls'
import { Button } from '@/components/ui/Button'
import { FormDialog } from '@/components/ui/Dialogs'

const LANGUAGE_OPTIONS = [
  { value: 'zh', label: '中文' },
  { value: 'en', label: 'English' },
] as const

interface TranslateModalProps {
  currentLang: string
  onConfirm: (targetLang: string) => void
  onCancel: () => void
  loading: boolean
}

export function TranslateModal({ currentLang, onConfirm, onCancel, loading }: TranslateModalProps) {
  const [targetLang, setTargetLang] = useState<string>(
    currentLang === 'zh' ? 'en' : 'zh'
  )

  const availableOptions = LANGUAGE_OPTIONS.filter(opt => opt.value !== currentLang)

  return (
    <FormDialog
      isOpen={true}
      onClose={onCancel}
      title="AI 翻译"
      size="lg"
      footer={
        <div className={unifiedStyles.u1}>
          <Button variant="ghost"
            onClick={onCancel}
            disabled={loading}
            className={unifiedStyles.u2}
          >
            取消
          </Button>
          <Button variant="ghost"
            onClick={() => onConfirm(targetLang)}
            disabled={loading || availableOptions.length === 0}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--primary)',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '0.875rem',
              fontWeight: 500,
              opacity: loading ? 0.7 : 1
            }}
          >
            {loading ? '翻译中...' : '确认翻译'}
          </Button>
        </div>
      }
    >
      <div className={unifiedStyles.u3}>
        <div className={unifiedStyles.u4}>
          <label className={unifiedStyles.u5}>
            翻译到
          </label>
          <Select aria-label="选择"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className={unifiedStyles.u6}
          >
            {availableOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </Select>
        </div>
        {availableOptions.length === 0 && (
          <div className={unifiedStyles.u7}>
            当前题面仅有一种语言版本，无法翻译。
          </div>
        )}
      </div>
    </FormDialog>
  )
}
