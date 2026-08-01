'use client'

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
  return (
    <div className={styles.tabs} role="tablist" aria-label={label}>
      {items.map(item => (
        <button
          key={item.value}
          type="button"
          className={styles.tab}
          role="tab"
          aria-selected={value === item.value}
          disabled={item.disabled}
          onClick={() => onChange(item.value)}
        >
          {item.label}{item.count === undefined ? '' : ` (${item.count})`}
        </button>
      ))}
    </div>
  )
}
