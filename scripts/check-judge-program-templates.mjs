import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { JUDGE_PROGRAM_TEMPLATES, OJ_GENERATOR_CPP_HEADER, parseGeneratorContext } = require('../packages/shared/dist/judge-program-protocol.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-template-check-'))
const failures = []

try {
  for (const template of JUDGE_PROGRAM_TEMPLATES) {
    if (!template.source.trim()) failures.push(`${template.id}: source is empty`)
    if (!template.protocolHelp.length || !template.learningNotes.length || !template.requiredChanges.length) failures.push(`${template.id}: documentation metadata is incomplete`)
    if (template.kind === 'standard' && (!template.examples.length || template.examples.some(item => item.expectedStdout === undefined))) failures.push(`${template.id}: standard fixtures require expectedStdout`)
    if (template.kind === 'validator' && (!template.examples.some(item => item.expectedExitCode === 0) || !template.examples.some(item => item.expectedExitCode !== undefined && item.expectedExitCode !== 0))) failures.push(`${template.id}: validator fixtures require accept and reject cases`)
    if (template.kind === 'classifier' && (!template.examples.length || template.examples.some(item => !item.expectedSubtasks?.length))) failures.push(`${template.id}: classifier fixtures require expectedSubtasks`)
    if (template.kind === 'generator') {
      if (!template.protocolConfig?.profiles.length || !Object.keys(template.protocolConfig.parameterSchema || {}).length) failures.push(`${template.id}: generator protocolConfig is incomplete`)
      const profileIds = new Set(template.protocolConfig?.profiles.map(item => item.id) || [])
      for (const fixture of template.examples) {
        try {
          const context = parseGeneratorContext(fixture.stdin)
          if (!profileIds.has(context.profile)) failures.push(`${template.id}: fixture uses unknown profile ${context.profile}`)
          for (const key of Object.keys(context.params)) if (!template.protocolConfig?.parameterSchema[key]) failures.push(`${template.id}: fixture uses unknown parameter ${key}`)
        } catch (error) {
          failures.push(`${template.id}: invalid Generator fixture: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    const dir = path.join(root, template.id)
    fs.mkdirSync(dir, { recursive: true })
    if (template.language === 'validator-dsl') {
      try {
        const spec = JSON.parse(template.source)
        if (spec?.version !== 1 || spec?.strictEof !== true || !Array.isArray(spec?.input) || !spec.input.length) failures.push(`${template.id}: Validator DSL example is incomplete`)
      } catch (error) {
        failures.push(`${template.id}: Validator DSL is not valid JSON`)
      }
      continue
    }
    if (template.language === 'python3') {
      const source = path.join(dir, 'main.py')
      fs.writeFileSync(source, template.source)
      const result = spawnSync('python3', ['-m', 'py_compile', source], { encoding: 'utf8' })
      if (result.status !== 0) failures.push(`${template.id}: ${result.stderr || 'py_compile failed'}`)
      continue
    }
    if (template.language !== 'cpp17') continue
    fs.writeFileSync(path.join(dir, 'main.cpp'), template.source)
    fs.writeFileSync(path.join(dir, 'oj_generator.hpp'), OJ_GENERATOR_CPP_HEADER)
    fs.copyFileSync(path.join(process.cwd(), 'apps', 'judge', 'checker-includes', 'testlib.h'), path.join(dir, 'testlib.h'))
    const result = spawnSync('g++', ['main.cpp', '-O2', '-std=c++17', '-Wall', '-o', process.platform === 'win32' ? 'main.exe' : 'main'], { cwd: dir, encoding: 'utf8' })
    if (result.status !== 0) failures.push(`${template.id}: ${result.stderr || 'g++ failed'}`)
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true })
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}
console.log(`Judge program template check passed: ${JUDGE_PROGRAM_TEMPLATES.length} templates.`)
