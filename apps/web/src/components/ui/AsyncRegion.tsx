'use client'

import type { ReactNode } from 'react'
import type { ResourceState } from '@/lib/resource'
import { Empty } from './Empty'
import { LoadError } from './LoadError'

export function SkeletonRegion({
  rows = 4,
  label = '内容正在准备',
}: {
  rows?: number
  label?: string
}) {
  return (
    <div className="resource-skeleton" aria-label={label} aria-busy="true">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="resource-skeleton-line"
          style={{ width: index === rows - 1 ? '62%' : '100%' }}
        />
      ))}
    </div>
  )
}

export function AsyncRegion<T>({
  state,
  onRetry,
  emptyText,
  skeletonRows,
  children,
}: {
  state: ResourceState<T>
  onRetry: () => void
  emptyText?: string
  skeletonRows?: number
  children: (data: T, refreshing: boolean) => ReactNode
}) {
  if (state.state === 'pending') {
    return state.previousData
      ? <>{children(state.previousData, true)}</>
      : <SkeletonRegion rows={skeletonRows} />
  }

  if (state.state === 'error') {
    if (state.previousData) {
      return (
        <>
          <LoadError
            compact
            message={state.error.message}
            requestId={state.error.requestId}
            onRetry={onRetry}
          />
          {children(state.previousData, false)}
        </>
      )
    }
    return (
      <LoadError
        message={state.error.message}
        requestId={state.error.requestId}
        onRetry={onRetry}
      />
    )
  }

  if (state.state === 'empty') {
    return <Empty text={emptyText} />
  }

  return <>{children(state.data, state.refreshing)}</>
}
