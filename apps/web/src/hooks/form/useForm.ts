'use client'

import { useState } from 'react'

export interface UseFormResult<T> {
  values: T
  errors: Partial<Record<keyof T, string>>
  submitting: boolean
  handleChange: (field: keyof T, value: any) => void
  handleSubmit: (e?: React.FormEvent) => Promise<void>
  reset: () => void
  setValues: (values: T) => void
  setErrors: (errors: Partial<Record<keyof T, string>>) => void
}

export function useForm<T extends Record<string, any>>(
  initialValues: T,
  onSubmit: (values: T) => Promise<void>
): UseFormResult<T> {
  const [values, setValues] = useState<T>(initialValues)
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({})
  const [submitting, setSubmitting] = useState(false)

  const handleChange = (field: keyof T, value: any) => {
    setValues((prev) => ({ ...prev, [field]: value }))
    // 清除该字段的错误
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setSubmitting(true)
    setErrors({})
    try {
      await onSubmit(values)
    } catch (error: any) {
      // 如果错误对象包含 errors 字段，设置表单错误
      if (error.errors) {
        setErrors(error.errors)
      }
      // 重新抛出错误，让调用者处理
      throw error
    } finally {
      setSubmitting(false)
    }
  }

  const reset = () => {
    setValues(initialValues)
    setErrors({})
  }

  return {
    values,
    errors,
    submitting,
    handleChange,
    handleSubmit,
    reset,
    setValues,
    setErrors
  }
}
