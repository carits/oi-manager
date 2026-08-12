import fs from 'node:fs'
import path from 'node:path'
import { expect, test } from '@playwright/test'
import { routePatterns } from '../fixtures/routes'

function collectPages(directory: string, appDirectory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) return collectPages(entryPath, appDirectory)
    if (entry.name !== 'page.tsx') return []

    const relative = path.relative(appDirectory, entryPath).replaceAll(path.sep, '/')
    const route = relative === 'page.tsx'
      ? '/'
      : `/${relative.replace(/\/page\.tsx$/, '')}`
    return [route]
  })
}

test('route manifest covers every Next.js page @smoke', async () => {
  const appDirectory = path.resolve(__dirname, '../../apps/web/src/app')
  const sourceRoutes = collectPages(appDirectory, appDirectory).sort()
  expect([...routePatterns].sort()).toEqual(sourceRoutes)
  expect(routePatterns.length).toBeGreaterThan(0)
})
