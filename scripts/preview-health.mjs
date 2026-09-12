import { assertHealthContract } from './lib/health-contract.mjs'

const target = process.env.PREVIEW_URL || 'http://127.0.0.1:3000/login'
const apiTarget =
  process.env.PREVIEW_API_URL || new URL('/api/health', target).toString()
const expectedBuildId = process.env.EXPECTED_BUILD_ID

try {
  for (const url of [target, apiTarget]) {
    const response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    })
    if (response.status >= 400) {
      throw new Error(`${url} returned HTTP ${response.status}`)
    }
    if (url === apiTarget) {
      assertHealthContract(await response.json(), url)
    }
    console.log(`Preview healthy: ${url} (${response.status})`)
  }
  if (expectedBuildId) {
    const manifestUrl = new URL(
      `/_next/static/${expectedBuildId}/_buildManifest.js`,
      target,
    ).toString()
    const response = await fetch(manifestUrl, {
      redirect: 'manual',
      signal: AbortSignal.timeout(3000),
    })
    if (response.status !== 200) {
      throw new Error(
        `Expected build ${expectedBuildId} is not being served (${response.status})`,
      )
    }
    console.log(`Preview build verified: ${expectedBuildId}`)
  }
} catch (error) {
  console.error(`Preview unhealthy: ${error.message}`)
  process.exitCode = 1
}
