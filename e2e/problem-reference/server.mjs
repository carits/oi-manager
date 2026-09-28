import { createRequire } from 'node:module'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
// Reuse the repository's installed Vitest/Vite toolchain; no extra runtime dependency.
const fromWeb = createRequire(path.join(root, 'apps/web/package.json'))
const fromVitest = createRequire(fromWeb.resolve('vitest/package.json'))
const fromVite = createRequire(fromVitest.resolve('vite/package.json'))
const { build } = fromVite('esbuild')
const output = path.join(root, 'test-results/problem-reference/site')
fs.mkdirSync(output, { recursive: true })
const shim = path.join(import.meta.dirname, 'browser-shims.tsx')
await build({
  entryPoints: [path.join(import.meta.dirname, 'entry.tsx')],
  outdir: output,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  jsx: 'automatic',
  sourcemap: true,
  tsconfig: path.join(root, 'apps/web/tsconfig.json'),
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  alias: {
    '@/features/auth': shim,
    'next/navigation': shim,
    'next/link': shim,
    '@': path.join(root, 'apps/web/src'),
    // E2E lives outside the web package. Resolve one shared React instance from
    // that workspace rather than relying on a root-level hoisted dependency.
    'react': path.dirname(fromWeb.resolve('react/package.json')),
    'react-dom': path.dirname(fromWeb.resolve('react-dom/package.json')),
  },
  loader: { '.woff2': 'file', '.woff': 'file', '.ttf': 'file', '.png': 'file', '.svg': 'file' },
})
const html = '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/entry.css"></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>'
const types = { '.js': 'text/javascript', '.css': 'text/css', '.map': 'application/json' }
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://127.0.0.1:3197').pathname
  if (pathname.startsWith('/api/')) {
    res.writeHead(503, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ success: false, message: '测试必须显式提供本地 API 响应' }))
    return
  }
  const file = path.join(output, path.basename(pathname))
  if (path.extname(file) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
    fs.createReadStream(file).pipe(res)
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(html)
})
server.listen(3197, '127.0.0.1', () => console.log('Problem reference browser harness ready'))
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)))
