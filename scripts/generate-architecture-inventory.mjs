import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const output = path.join(root, 'docs/architecture/generated/ARCHITECTURE_INVENTORY.md')
const check = process.argv.includes('--check')

function walk(directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

const legacyRoutes = walk(path.join(root, 'apps/server/src/routes')).filter(file => file.endsWith('.ts'))
const moduleRoutes = walk(path.join(root, 'apps/server/src/modules')).filter(file => file.endsWith('.routes.ts'))
const schema = fs.readFileSync(path.join(root, 'apps/server/prisma/schema.prisma'), 'utf8')
const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map(match => match[1]).sort()
const enums = [...schema.matchAll(/^enum\s+(\w+)/gm)].map(match => match[1]).sort()
const units = walk(path.join(root, 'deploy/systemd')).filter(file => file.endsWith('.service')).map(file => path.basename(file)).sort()
const sourceFiles = [
  ...walk(path.join(root, 'apps/server/src')),
  ...walk(path.join(root, 'apps/judge/src')),
  ...walk(path.join(root, 'scripts')),
].filter(file => /\.(?:ts|tsx|js|mjs|sh)$/.test(file))
const environment = new Set()
for (const file of sourceFiles) {
  const source = fs.readFileSync(file, 'utf8')
  for (const match of source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) environment.add(match[1])
  for (const match of source.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})\}?/g)) environment.add(match[1])
}

const relative = file => path.relative(root, file).replaceAll('\\', '/')
const content = `---
status: reference
audience: development, operations
last_verified: generated
source_of_truth: scripts/generate-architecture-inventory.mjs
---

# 架构事实清单（自动生成）

此文件不得手工编辑。运行 \`pnpm architecture:inventory\` 更新，\`pnpm architecture:check\` 校验。

## 规模

| 项目 | 数量 |
|---|---:|
| Prisma models | ${models.length} |
| Prisma enums | ${enums.length} |
| Legacy route adapters | ${legacyRoutes.length} |
| Module route adapters | ${moduleRoutes.length} |
| systemd units | ${units.length} |
| Referenced environment keys | ${environment.size} |

## HTTP adapter ownership

### Legacy adapters（Strangler 待迁移）

${legacyRoutes.sort().map(file => `- \`${relative(file)}\``).join('\n')}

### Domain module adapters

${moduleRoutes.sort().map(file => `- \`${relative(file)}\``).join('\n')}

## Prisma models

${models.map(name => `- \`${name}\``).join('\n')}

## Prisma enums

${enums.map(name => `- \`${name}\``).join('\n')}

## systemd units

${units.map(name => `- \`${name}\``).join('\n')}

## Environment key inventory（不含值）

${[...environment].sort().map(name => `- \`${name}\``).join('\n')}
`

if (check) {
  if (!fs.existsSync(output) || fs.readFileSync(output, 'utf8') !== content) {
    console.error('Architecture inventory is stale; run pnpm architecture:inventory')
    process.exit(1)
  }
  console.log('Architecture inventory is current')
} else {
  fs.mkdirSync(path.dirname(output), { recursive: true })
  fs.writeFileSync(output, content)
  console.log(`Architecture inventory generated: ${path.relative(root, output)}`)
}
