import { describe, expect, it } from 'vitest'
import { featureResourceKey, visibleFeatureData } from './featureResource'
import { toResourceState } from './resource'
import { ApiError } from './apiClient'

describe('feature resource presentation isolation', () => {
  const previous = { scope: 'user-1:school-a', key: 'training:active:1', data: { items: ['A'], total: 1 } }
  it('retains previous filter results only inside the same account and workspace', () => {
    expect(visibleFeatureData(previous, 'user-1:school-a')).toEqual(previous.data)
    expect(visibleFeatureData(previous, 'user-1:school-b')).toBeUndefined()
    expect(visibleFeatureData(previous, 'user-2:school-a')).toBeUndefined()
    expect(visibleFeatureData(previous, 'user-1:personal')).toBeUndefined()
  })
  it('distinguishes account, workspace and query in the cache key', () => {
    expect(featureResourceKey('a', 'list:1')).not.toEqual(featureResourceKey('b', 'list:1'))
    expect(featureResourceKey('a', 'list:1')).not.toEqual(featureResourceKey('a', 'list:2'))
    expect(featureResourceKey(null, 'list:1')).toBeNull()
    expect(featureResourceKey('a', 'list:1', false)).toBeNull()
  })
  it('never turns an unsuccessful first read into a business-empty state', () => {
    const error = new ApiError({ kind: 'http', status: 503, userMessage: '服务暂不可用' })
    expect(toResourceState({ error, isValidating: false }, () => true)).toMatchObject({ state: 'error', error })
    expect(toResourceState({ data: [], isValidating: false }, data => data.length === 0)).toEqual({ state: 'empty' })
  })
  it('keeps failed refresh data with an explicit error', () => {
    const error = new ApiError({ kind: 'timeout', status: 0, userMessage: '更新超时' })
    expect(toResourceState({ data: previous.data, error, isValidating: false }, () => false)).toMatchObject({ state: 'error', previousData: previous.data })
  })
})
