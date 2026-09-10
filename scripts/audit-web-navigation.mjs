import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const appRoot = path.join(root, 'apps/web/src/app')
const sourceRoot = path.join(root, 'apps/web/src')
const reportPath = path.join(root, 'test-results/navigation-static-report.json')
const prohibitedPaths = new Set([
  '/teacher/school/contests',
  '/student/school/contests',
])

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return walk(fullPath)
    return [fullPath]
  }))
  return files.flat()
}

function routeFromPage(file) {
  const relative = path.relative(appRoot, path.dirname(file)).split(path.sep)
  const segments = relative.filter(segment => !segment.startsWith('(') && !segment.startsWith('@'))
  return `/${segments.map(segment => segment.startsWith('[') ? ':dynamic' : segment).filter(Boolean).join('/')}`.replace(/\/$/, '') || '/'
}

function matchesPage(pathname, routes) {
  return routes.some(route => {
    const pattern = `^${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(':dynamic', '[^/]+')}$`
    return new RegExp(pattern).test(pathname)
  })
}

function classify(pathname, routes) {
  if (/\/(undefined|null)(?:\/|$)/.test(pathname)) return '缺少动态标识'
  if (prohibitedPaths.has(pathname)) return '不存在的详情父路径'
  if (!matchesPage(pathname, routes)) return '不存在的静态路径'
  return null
}

const sourceFiles = (await walk(sourceRoot)).filter(file => /\.(ts|tsx)$/.test(file))
const pageFiles = (await walk(appRoot)).filter(file => file.endsWith('/page.tsx') || file.endsWith('\\page.tsx'))
const routes = pageFiles.map(routeFromPage)
const findings = []

for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8')
  source.split(/\r?\n/).forEach((line, index) => {
    if (!/(?:href\s*=|router\.(?:push|replace)|window\.location)/.test(line)) return
    const lineNumber = index + 1
    const staticPaths = [...line.matchAll(/(?:href\s*=|router\.(?:push|replace)\(|window\.location(?:\.href)?\s*=|window\.location\.(?:assign|replace)\()\s*["'](\/[^"']*)["']/g)]
    for (const match of staticPaths) {
      const pathname = match[1].split(/[?#]/)[0]
      const risk = classify(pathname, routes)
      if (risk) findings.push({ file: path.relative(root, file), line: lineNumber, expression: match[0], target: pathname, risk, severity: 'error' })
    }

    const templateMatch = line.match(/(?:href\s*=|router\.(?:push|replace)\(|window\.location\.(?:assign|replace)\()\s*\{?`([^`]+)`/)
    if (templateMatch) {
      const template = templateMatch[1]
      const staticPrefix = template.split('${')[0].replace(/\/$/, '')
      const usesNavigationHelper = /(resourceHref|listHref|moduleHref|workspaceHref|notificationHref)/.test(line)
      if (prohibitedPaths.has(staticPrefix)) {
        findings.push({ file: path.relative(root, file), line: lineNumber, expression: template, target: staticPrefix, risk: '不存在的详情父路径', severity: 'error' })
      } else if (!usesNavigationHelper && !template.startsWith('?') && !template.startsWith('#')) {
        findings.push({ file: path.relative(root, file), line: lineNumber, expression: template, target: staticPrefix, risk: '尚未迁移到统一路由函数', severity: 'warning' })
      }
    }
  })
}

const report = { generatedAt: new Date().toISOString(), pageRoutes: routes.sort(), findings }
await mkdir(path.dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`)
const errors = findings.filter(finding => finding.severity === 'error')
console.log(`导航静态巡检：${routes.length} 个页面路由，${findings.length} 条发现，${errors.length} 条阻断问题。`)
for (const finding of errors) console.error(`${finding.file}:${finding.line} ${finding.risk} -> ${finding.target}`)
if (errors.length) process.exitCode = 1
