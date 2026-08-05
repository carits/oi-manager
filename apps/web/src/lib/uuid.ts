export function createClientUUID(): string {
  const cryptoObject = globalThis.crypto
  if (typeof cryptoObject?.randomUUID === 'function') {
    return cryptoObject.randomUUID()
  }

  if (typeof cryptoObject?.getRandomValues === 'function') {
    const bytes = cryptoObject.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0'))
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const value = Math.floor(Math.random() * 16)
    const nibble = char === 'x' ? value : (value & 0x3) | 0x8
    return nibble.toString(16)
  })
}
