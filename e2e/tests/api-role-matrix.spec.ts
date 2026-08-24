import fs from 'node:fs'
import path from 'node:path'
import { expect, request as requestFactory, test } from '@playwright/test'
import { accounts, type AuthRole } from '../fixtures/auth'
import { loadFixtureIds, type FixtureIds } from '../fixtures/data'

type Endpoint = { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string }

const root = path.resolve(__dirname, '../..')
const apiDocument = fs.readFileSync(path.join(root, 'docs/reference/api/README.md'), 'utf8')
const endpointPattern = /^\|\s*`(GET|POST|PUT|PATCH|DELETE)`\s*\|\s*`(\/api[^`]*)`\s*\|/gm
const endpoints = [...apiDocument.matchAll(endpointPattern)].map(match => ({
  method: match[1] as Endpoint['method'],
  path: match[2],
}))
const ids = loadFixtureIds()
const allRoles = Object.keys(accounts) as AuthRole[]
const selectedRole = process.env.API_MATRIX_ROLE as AuthRole | undefined
const roles = selectedRole && allRoles.includes(selectedRole) ? [selectedRole] : allRoles

function genericGetId(routePath: string, fixture: FixtureIds): string {
  if (routePath.startsWith('/api/trainings/')) return fixture.contest
  if (routePath.startsWith('/api/submissions/')) return fixture.submission
  if (routePath.startsWith('/api/problems/')) return fixture.problem
  if (routePath.startsWith('/api/teams/')) return fixture.team
  if (routePath.startsWith('/api/problem-lists/')) return fixture.problemList
  return 'audit-missing-id'
}

function concretePath(endpoint: Endpoint): string {
  const useReadableFixture = endpoint.method === 'GET'
  return endpoint.path
    .replace(/:([A-Za-z][A-Za-z0-9_]*)/g, (_full, name: string) => {
      if (name === 'organizationId') return `org_${ids.school}`
      if (!useReadableFixture) return `audit-missing-${name}`
      if (name === 'teamId') return ids.team
      if (name === 'trainingId') return ids.contest
      if (name === 'submissionId') return ids.submission
      if (name === 'problemId') return ids.problem
      if (name === 'id') return genericGetId(endpoint.path, ids)
      return `audit-missing-${name}`
    })
    .replace(/\*/g, 'audit-missing-wildcard')
}

test.describe('authenticated API robustness matrix', () => {
  for (const role of roles) {
    test(`${role} receives no 5xx across the documented API`, async () => {
      const organizationRole = role === 'principal' || role === 'teacher' || role === 'campusStudent'
      const context = await requestFactory.newContext({
        baseURL: 'http://127.0.0.1:3100',
        storageState: accounts[role].storageState,
        extraHTTPHeaders: organizationRole
          ? { 'x-oi-organization-id': `org_${ids.school}` }
          : undefined,
      })
      const failures: string[] = []
      const statusCounts = new Map<number, number>()
      const orderedEndpoints = [
        ...endpoints.filter(endpoint => endpoint.path !== '/api/auth/logout'),
        ...endpoints.filter(endpoint => endpoint.path === '/api/auth/logout'),
      ]

      for (let index = 0; index < orderedEndpoints.length; index += 12) {
        await Promise.all(orderedEndpoints.slice(index, index + 12).map(async endpoint => {
          const url = concretePath(endpoint)
          try {
            const response = await context.fetch(url, {
              method: endpoint.method,
              data: endpoint.method === 'GET' || endpoint.method === 'DELETE' ? undefined : {},
              failOnStatusCode: false,
              maxRedirects: 0,
              timeout: 10_000,
            })
            const status = response.status()
            statusCounts.set(status, (statusCounts.get(status) || 0) + 1)
            if (status >= 500) failures.push(`${endpoint.method} ${endpoint.path} -> ${status}`)
            await response.dispose()
          } catch (error) {
            failures.push(`${endpoint.method} ${endpoint.path} -> ${error instanceof Error ? error.message : String(error)}`)
          }
        }))
      }

      await context.dispose()
      expect(failures, `${role} failures:\n${failures.slice(0, 30).join('\n')}`).toEqual([])
      expect([...statusCounts.values()].reduce((sum, count) => sum + count, 0)).toBe(endpoints.length)
    })
  }
})
