const target = process.env.PREVIEW_URL || 'http://127.0.0.1:3000/login'
const apiTarget =
  process.env.PREVIEW_API_URL || new URL('/api/health', target).toString()

try {
  for (const url of [target, apiTarget]) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    })
    if (response.status >= 400) {
      throw new Error(`${url} returned HTTP ${response.status}`)
    }
    console.log(`Preview healthy: ${url} (${response.status})`)
  }
} catch (error) {
  console.error(`Preview unhealthy: ${error.message}`)
  process.exitCode = 1
}
