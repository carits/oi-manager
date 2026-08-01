'use client'

import styles from './primitives.module.css'

export interface SegmentItem<T extends string> {
  value: T
  label: string
}

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  disabled = false,
  label,
}: {
  items: SegmentItem<T>[]
  value: T
  onChange: (value: T) => void
  disabled?: boolean
  label: string
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {items.map(item => (
        <button
          key={item.value}
          type="button"
          className={styles.segment}
          aria-pressed={value === item.value}
          disabled={disabled}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
