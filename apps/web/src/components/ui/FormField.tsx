import React, { isValidElement, useId } from 'react'
import styles from './primitives.module.css'

export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
}: {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactElement<any>
}) {
  const generatedId = useId()
  const controlId = children.props.id || generatedId
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const descriptionIds = [children.props['aria-describedby'], hintId, errorId].filter(Boolean).join(' ')
  const descriptionId = descriptionIds || undefined
  const control = isValidElement<any>(children)
    ? React.cloneElement(children, {
        id: controlId,
        className: `${styles.formControl} ${children.props.className || ''}`.trim(),
        'aria-invalid': Boolean(error) || undefined,
        'aria-required': required || undefined,
        'aria-describedby': descriptionId,
      })
    : children

  return (
    <div className={styles.formField}>
      <label className={styles.formLabel} htmlFor={controlId}>
        {label}{required && <span className={styles.requiredMark} aria-hidden="true">*</span>}
      </label>
      {control}
      {hint && <p className={styles.formHint} id={hintId}>{hint}</p>}
      {error && <p className={styles.formError} id={errorId} role="alert">{error}</p>}
    </div>
  )
}
