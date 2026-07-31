import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const sourceRoots = [
  path.join(root, 'apps', 'web', 'src', 'app'),
  path.join(root, 'apps', 'web', 'src', 'components'),
  path.join(root, 'apps', 'web', 'src', 'hooks'),
]
const failures = []

function collect(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) return collect(absolute)
    return /\.(?:ts|tsx)$/.test(entry.name) ? [absolute] : []
  })
}

for (const file of sourceRoots.flatMap(collect)) {
  const source = fs.readFileSync(file, 'utf8')
  const relative = path.relative(root, file).replaceAll('\\', '/')

  if (source.includes('加载中')) {
    failures.push(`${relative}: visible loading copy is forbidden`)
  }

  if (
    /\b(?:const|let)\s*\[\s*(?:mounted|isMounted)\b/.test(source) ||
    /\bif\s*\(\s*!(?:mounted|isMounted)\b/.test(source)
  ) {
    failures.push(`${relative}: page-level mounted render gate is forbidden`)
  }

  if (relative.includes('/app/') && relative.endsWith('/page.tsx') && source.includes('ProtectedRoute')) {
    failures.push(`${relative}: role layouts own authorization; page-level ProtectedRoute is forbidden`)
  }

  if (
    !relative.includes('/app/api/') &&
    /\bfetch\s*\(/.test(source)
  ) {
    failures.push(`${relative}: browser requests must use apiClient so timeout and error contracts apply`)
  }
}

if (failures.length > 0) {
  console.error(`UI state contract failed with ${failures.length} issue(s):`)
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('UI state contract passed: loading, auth-wrapper, mounted-gate, and request-client rules hold.')
