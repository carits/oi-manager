'use client'

import { useRef, type KeyboardEvent } from 'react'
import styles from './primitives.module.css'

export interface TabItem<T extends string> {
  value: T
  label: string
  count?: number
  disabled?: boolean
}

export function Tabs<T extends string>({
  items,
  value,
  onChange,
  label = '页面分区',
}: {
  items: TabItem<T>[]
  value: T
  onChange: (value: T) => void
  label?: string
}) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const enabledIndexes = items.map((item, index) => item.disabled ? -1 : index).filter(index => index >= 0)
    if (!enabledIndexes.length) return
    event.preventDefault()
    const position = enabledIndexes.indexOf(currentIndex)
    const nextIndex = event.key === 'Home'
      ? enabledIndexes[0]
      : event.key === 'End'
        ? enabledIndexes.at(-1)!
        : event.key === 'ArrowRight'
          ? enabledIndexes[(position + 1 + enabledIndexes.length) % enabledIndexes.length]
          : enabledIndexes[(position - 1 + enabledIndexes.length) % enabledIndexes.length]
    tabRefs.current[nextIndex]?.focus()
    onChange(items[nextIndex].value)
  }
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map((item, index) => (
        <button
          ref={element => { tabRefs.current[index] = element }}
          key={item.value}
          type="button"
          className={styles.tab}
          role="tab"
          aria-selected={value === item.value}
          tabIndex={value === item.value ? 0 : -1}
          disabled={item.disabled}
          onKeyDown={event => handleKeyDown(event, index)}
          onClick={() => onChange(item.value)}
        >
          {item.label}{item.count === undefined ? '' : ` (${item.count})`}
        </button>
      ))}
    </div>
  )
}
