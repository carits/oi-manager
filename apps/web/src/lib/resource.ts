import type { ApiError } from './apiClient'

export type ResourceState<T> =
  | { state: 'pending'; previousData?: T }
  | { state: 'ready'; data: T; refreshing: boolean }
  | { state: 'empty' }
  | { state: 'error'; error: ApiError; previousData?: T }

export interface ResourceSnapshot<T> {
  data?: T
  error?: ApiError
  isValidating: boolean
}

export function toResourceState<T>(
  snapshot: ResourceSnapshot<T>,
  isEmpty: (data: T) => boolean,
): ResourceState<T> {
  if (snapshot.error) {
    return {
      state: 'error',
      error: snapshot.error,
      ...(snapshot.data === undefined ? {} : { previousData: snapshot.data }),
    }
  }

  if (snapshot.data === undefined) {
    return { state: 'pending' }
  }

  if (isEmpty(snapshot.data)) {
    return { state: 'empty' }
  }

  return {
    state: 'ready',
    data: snapshot.data,
    refreshing: snapshot.isValidating,
  }
}
