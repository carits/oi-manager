'use client'

import { useState } from 'react'
import { MarkdownRenderer } from './MarkdownRenderer'

interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  minHeight?: string
  showPreview?: boolean
  securityProfile?: 'standard' | 'knowledge'
}

export function MarkdownEditor({
  value,
  onChange,
  placeholder = '请输入 Markdown 内容...',
  minHeight = '300px',
  showPreview: initialShowPreview = false,
  securityProfile = 'standard',
}: MarkdownEditorProps) {
  const [mode, setMode] = useState<'edit' | 'preview' | 'split'>(initialShowPreview ? 'split' : 'edit')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.5rem',
        background: 'var(--gray-50)',
        borderBottom: '1px solid var(--border)',
        borderRadius: '6px 6px 0 0'
      }}>
        <button
          onClick={() => setMode('edit')}
          style={{
            padding: '0.25rem 0.75rem',
            border: 'none',
            borderRadius: '4px',
            background: mode === 'edit' ? 'var(--primary)' : 'transparent',
            color: mode === 'edit' ? 'white' : 'var(--gray-600)',
            cursor: 'pointer',
            fontSize: '0.75rem'
          }}
        >
          编辑
        </button>
        <button
          onClick={() => setMode('preview')}
          style={{
            padding: '0.25rem 0.75rem',
            border: 'none',
            borderRadius: '4px',
            background: mode === 'preview' ? 'var(--primary)' : 'transparent',
            color: mode === 'preview' ? 'white' : 'var(--gray-600)',
            cursor: 'pointer',
            fontSize: '0.75rem'
          }}
        >
          预览
        </button>
        <button
          onClick={() => setMode('split')}
          style={{
            padding: '0.25rem 0.75rem',
            border: 'none',
            borderRadius: '4px',
            background: mode === 'split' ? 'var(--primary)' : 'transparent',
            color: mode === 'split' ? 'white' : 'var(--gray-600)',
            cursor: 'pointer',
            fontSize: '0.75rem'
          }}
        >
          分栏
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: '0.7rem', color: 'var(--gray-400)' }}>支持 Markdown 和 LaTeX</span>
      </div>

      {/* 内容区域 */}
      <div style={{
        display: 'flex',
        flex: 1,
        minHeight,
        border: '1px solid var(--border)',
        borderTop: 'none',
        borderRadius: '0 0 6px 6px',
        overflow: 'hidden'
      }}>
        {/* 编辑器 */}
        {(mode === 'edit' || mode === 'split') && (
          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            style={{
              flex: mode === 'split' ? 1 : undefined,
              width: mode === 'edit' ? '100%' : undefined,
              minHeight,
              padding: '1rem',
              border: 'none',
              fontSize: '0.875rem',
              fontFamily: 'Consolas, Monaco, "Courier New", monospace',
              lineHeight: 1.6,
              resize: 'none',
              background: mode === 'split' ? 'var(--bg-muted)' : 'white',
              outline: 'none',
              boxSizing: 'border-box'
            }}
            spellCheck={false}
          />
        )}

        {/* 分隔线 */}
        {mode === 'split' && (
          <div style={{ width: '1px', background: 'var(--border)' }} />
        )}

        {/* 预览 */}
        {(mode === 'preview' || mode === 'split') && (
          <div
            style={{
              flex: mode === 'split' ? 1 : undefined,
              width: mode === 'preview' ? '100%' : undefined,
              minHeight,
              padding: '1rem',
              overflow: 'auto',
              background: 'white',
              boxSizing: 'border-box'
            }}
            className="markdown-content"
          >
            {value.trim() ? (
              <MarkdownRenderer content={value} securityProfile={securityProfile} />
            ) : (
              <div style={{ color: 'var(--gray-400)', fontSize: '0.875rem' }}>
                暂无内容
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
