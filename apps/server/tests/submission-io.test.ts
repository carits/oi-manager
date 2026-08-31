import { describe, expect, it } from 'vitest'
import {
  legacySubmissionIoSuggestion,
  normalizeSubmissionIo,
  resolveSubmissionIoSnapshot,
  SubmissionIoError,
} from '../src/modules/judge/domain/submission-io'

describe('submission IO domain', () => {
  it('supports all independent stdin/stdout and file combinations', () => {
    expect(normalizeSubmissionIo({})).toEqual({ inputFilename: null, outputFilename: null, ioAdapterVersion: 1 })
    expect(normalizeSubmissionIo({ inputFilename: 'travel.in' })).toMatchObject({ inputFilename: 'travel.in', outputFilename: null })
    expect(normalizeSubmissionIo({ outputFilename: 'travel.out' })).toMatchObject({ inputFilename: null, outputFilename: 'travel.out' })
    expect(normalizeSubmissionIo({ inputFilename: 'travel.in', outputFilename: 'travel.out' })).toMatchObject({ inputFilename: 'travel.in', outputFilename: 'travel.out' })
  })

  it.each(['../a.in', '/tmp/a', 'a/b.in', 'C:\\a.in', '..', 'main', 'main.cpp', 'stdout', 'a..in'])(
    'rejects unsafe or reserved filename %s', filename => {
      expect(() => normalizeSubmissionIo({ inputFilename: filename })).toThrow(SubmissionIoError)
    },
  )

  it('rejects equal filenames and unsupported problem types', () => {
    expect(() => normalizeSubmissionIo({ inputFilename: 'a.txt', outputFilename: 'a.txt' })).toThrow('不能相同')
    expect(() => normalizeSubmissionIo({ inputFilename: 'a.in', problemType: 'interactive' })).toThrow('不支持')
  })

  it('uses legacy prefix only for version zero snapshots', () => {
    expect(legacySubmissionIoSuggestion({ type: 'default', filename: 'travel' })).toMatchObject({ inputFilename: 'travel.in', outputFilename: 'travel.out' })
    expect(resolveSubmissionIoSnapshot({ ioAdapterVersion: 0 }, { filename: 'travel' })).toMatchObject({ inputFile: 'travel.in', outputFile: 'travel.out', ioAdapterVersion: 0 })
    expect(resolveSubmissionIoSnapshot({ ioAdapterVersion: 1 }, { filename: 'travel' })).toMatchObject({ inputFile: null, outputFile: null, ioAdapterVersion: 1 })
  })
})
