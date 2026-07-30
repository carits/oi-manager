'use client'

import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'

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
    <Modal
      isOpen={true}
      onClose={onCancel}
      title="AI 翻译"
      width="640px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <button
            onClick={onCancel}
            disabled={loading}
            style={{
              padding: '0.5rem 1rem',
              background: 'var(--gray-100)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '0.875rem'
            }}
          >
            取消
          </button>
          <button
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
          </button>
        </div>
      }
    >
      <div style={{ padding: '0.5rem 0' }}>
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.375rem', color: 'var(--gray-700)' }}>
            翻译到
          </label>
          <select aria-label="选择"
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            style={{
              width: '100%',
              padding: '0.5rem 0.75rem',
              border: '1px solid var(--border)',
              borderRadius: '4px',
              fontSize: '0.875rem',
              background: 'white'
            }}
          >
            {availableOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
        {availableOptions.length === 0 && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--gray-500)' }}>
            当前题面仅有一种语言版本，无法翻译。
          </div>
        )}
      </div>
    </Modal>
  )
}
