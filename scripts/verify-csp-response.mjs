const url = process.env.CSP_VERIFY_URL || process.argv[2]
if (!url) {
  console.error('Usage: CSP_VERIFY_URL=https://example.com/login node scripts/verify-csp-response.mjs')
  process.exit(2)
}

const response = await fetch(url, { redirect: 'manual' })
if (!response.ok) throw new Error(`CSP target returned HTTP ${response.status}`)

const policy =
  response.headers.get('content-security-policy') ||
  response.headers.get('content-security-policy-report-only')
if (!policy) throw new Error('CSP response header is missing')

const nonce = policy.match(/'nonce-([^']+)'/)?.[1]
if (!nonce) throw new Error('CSP script nonce is missing')
if (/script-src[^;]*'unsafe-inline'/.test(policy)) {
  throw new Error('CSP script-src still permits unsafe-inline')
}
if (!/script-src[^;]*'strict-dynamic'/.test(policy)) {
  throw new Error('CSP script-src is missing strict-dynamic')
}

const body = await response.text()
const escapedNonce = nonce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
if (!new RegExp(`nonce=["']${escapedNonce}["']`).test(body)) {
  throw new Error('Rendered framework scripts do not carry the response nonce')
}

console.log(JSON.stringify({
  status: 'ok',
  url,
  mode: response.headers.has('content-security-policy') ? 'enforce' : 'report-only',
  nonceMatched: true,
  unsafeInlineScript: false,
  strictDynamic: true,
}, null, 2))
