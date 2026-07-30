import fs from 'node:fs'
import path from 'node:path'

export interface E2ERuntimeSecrets {
  accountPassword: string
  jwtSecret: string
  judgeToken: string
}

export function loadRuntimeSecrets(): E2ERuntimeSecrets {
  const runtimePath = path.resolve(__dirname, '../../test-results/e2e-runtime.json')
  if (!fs.existsSync(runtimePath)) {
    throw new Error(`Missing ${runtimePath}. Run pnpm test:ui:prepare first.`)
  }
  return JSON.parse(fs.readFileSync(runtimePath, 'utf8')) as E2ERuntimeSecrets
}
