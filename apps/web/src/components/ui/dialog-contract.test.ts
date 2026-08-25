import { describe, expect, it } from 'vitest'
import { MODAL_SIZE_WIDTHS, dialogCloseAction } from './dialog-contract'

describe('dialog contract', () => {
  it('uses only the five documented width presets', () => {
    expect(MODAL_SIZE_WIDTHS).toEqual({ sm: '420px', md: '560px', lg: '720px', xl: '960px', wide: '1200px' })
  })

  it('blocks busy dialogs and confirms dirty forms', () => {
    expect(dialogCloseAction(true, true)).toBe('ignore')
    expect(dialogCloseAction(true, false)).toBe('ignore')
    expect(dialogCloseAction(false, true)).toBe('confirm')
    expect(dialogCloseAction(false, false)).toBe('close')
  })
})
