export async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // HTTP deployments may expose the API but deny access; use the legacy selection fallback.
    }
  }
  const element = document.createElement('textarea')
  element.value = value
  element.setAttribute('readonly', '')
  element.style.position = 'fixed'
  element.style.opacity = '0'
  document.body.appendChild(element)
  element.select()
  const copied = document.execCommand('copy')
  element.remove()
  if (!copied) throw new Error('COPY_NOT_AVAILABLE')
}
