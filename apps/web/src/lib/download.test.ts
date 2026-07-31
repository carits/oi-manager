import { describe, expect, it } from 'vitest'
import { filenameFromContentDisposition } from './download'

describe('filenameFromContentDisposition', () => {
  it('prefers a UTF-8 filename', () => {
    expect(
      filenameFromContentDisposition(
        "attachment; filename*=UTF-8''%E9%A2%98%E7%9B%AE.pdf",
        'download',
      ),
    ).toBe('题目.pdf')
  })

  it('falls back safely when the header is missing', () => {
    expect(filenameFromContentDisposition(undefined, 'attachment.zip')).toBe(
      'attachment.zip',
    )
  })
})
