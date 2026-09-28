import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = process.cwd()
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'oi-architecture-progress-'))
const currentFile = path.join(temporary, 'current.json')
const baseFile = path.join(temporary, 'base.json')

function run(args, env) {
  return spawnSync(process.execPath, ['scripts/architecture-progress.mjs', ...args], {
    cwd: root, encoding: 'utf8', env: { ...process.env, ...env },
  })
}

try {
  execFileSync(process.execPath, ['scripts/architecture-progress.mjs'], {
    cwd: root, env: { ...process.env, ARCHITECTURE_PROGRESS_FILE: currentFile }, stdio: 'pipe',
  })
  const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'))

  fs.writeFileSync(currentFile, JSON.stringify({ ...current, contracts: current.contracts + 1 }))
  const stale = run(['--check'], { ARCHITECTURE_PROGRESS_FILE: currentFile })
  if (stale.status === 0 || !`${stale.stderr}${stale.stdout}`.includes('is stale')) {
    throw new Error('Stale architecture progress was not rejected')
  }

  fs.writeFileSync(currentFile, JSON.stringify(current))
  const canExerciseLegacyRegression = current.transport.legacy.calls > 0
  fs.writeFileSync(baseFile, JSON.stringify({
    ...current,
    contractedBoundaries: current.contractedBoundaries + 1,
    transport: {
      ...current.transport,
      legacy: {
        ...current.transport.legacy,
        calls: canExerciseLegacyRegression ? current.transport.legacy.calls - 1 : current.transport.legacy.calls,
      },
    },
  }))
  const regression = run(['--gate'], {
    ARCHITECTURE_PROGRESS_FILE: currentFile,
    ARCHITECTURE_PROGRESS_BASE_FILE: baseFile,
  })
  const regressionOutput = `${regression.stderr}${regression.stdout}`
  const missingLegacyReason = canExerciseLegacyRegression && !regressionOutput.includes('legacy transport calls increased')
  if (regression.status === 0
    || missingLegacyReason
    || !regressionOutput.includes('contracted boundary count decreased')) {
    throw new Error('Architecture regression was not rejected with the expected reasons')
  }

  console.log('Architecture progress verifier passed: stale state and metric regressions are rejected.')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
