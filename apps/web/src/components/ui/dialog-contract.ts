export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'wide'

export const MODAL_SIZE_WIDTHS: Record<ModalSize, string> = {
  sm: '420px',
  md: '560px',
  lg: '720px',
  xl: '960px',
  wide: '1200px',
}

export function dialogCloseAction(busy: boolean, dirty: boolean): 'ignore' | 'confirm' | 'close' {
  if (busy) return 'ignore'
  return dirty ? 'confirm' : 'close'
}
