import { describe, expect, it } from 'vitest'
import { ApiError } from './apiClient'
import { toResourceState } from './resource'

const isEmpty = (value: string[]) => value.length === 0

describe('toResourceState', () => {
  it('starts in pending without inventing an empty result', () => {
    expect(toResourceState<string[]>({
      data: undefined,
      isValidating: true,
    }, isEmpty)).toEqual({ state: 'pending' })
  })

  it('marks only a successful empty value as empty', () => {
    expect(toResourceState<string[]>({
      data: [],
      isValidating: false,
    }, isEmpty)).toEqual({ state: 'empty' })
  })

  it('keeps ready data visible while it refreshes', () => {
    expect(toResourceState<string[]>({
      data: ['cached'],
      isValidating: true,
    }, isEmpty)).toEqual({
      state: 'ready',
      data: ['cached'],
      refreshing: true,
    })
  })

  it('retains previous data when a refresh fails', () => {
    const error = new ApiError({
      kind: 'network',
      status: 0,
      userMessage: 'offline',
    })

    expect(toResourceState<string[]>({
      data: ['cached'],
      error,
      isValidating: false,
    }, isEmpty)).toEqual({
      state: 'error',
      error,
      previousData: ['cached'],
    })
  })

  it('reports an initial failure as an error without an empty fallback', () => {
    const error = new ApiError({
      kind: 'http',
      status: 500,
      userMessage: 'failed',
    })

    expect(toResourceState<string[]>({
      error,
      isValidating: false,
    }, isEmpty)).toEqual({
      state: 'error',
      error,
    })
  })
})
