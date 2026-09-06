import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { JUDGE_PROGRAM_TEMPLATES, OJ_GENERATOR_CPP_HEADER } = require('../packages/shared/dist/judge-program-protocol.js')
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'judge-template-check-'))
const failures = []

try {
  for (const template of JUDGE_PROGRAM_TEMPLATES) {
    const dir = path.join(root, template.id)
    fs.mkdirSync(dir, { recursive: true })
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
