import type { Page, Route } from '@playwright/test'

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

export async function installExternalMocks(page: Page) {
  const handlePlatformBinding = async (route: Route) => {
    if (route.request().method() === 'GET') {
      const pathname = new URL(route.request().url()).pathname
      if (pathname === '/api/platform-bindings/platforms') {
        return json(route, {
          success: true,
          data: [
            { id: 'luogu', name: 'Luogu', color: '#2563eb', supported: true },
            { id: 'vjudge', name: 'VJudge', color: '#16a34a', supported: true },
          ],
        })
      }
      if (pathname === '/api/platform-bindings') {
        return json(route, { success: true, data: [] })
      }
      return json(route, {
        success: true,
        data: { bound: true, username: 'e2e-bound-user', platform: 'luogu' },
      })
    }
    return json(route, { success: true, data: { bound: true } })
  }
  await page.route('**/api/platform-bindings', handlePlatformBinding)
  await page.route('**/api/platform-bindings/**', handlePlatformBinding)

  await page.route('**/api/team-import/**', async route => {
    const url = route.request().url()
    const pathname = new URL(url).pathname
    if (url.endsWith('/platforms')) {
      return json(route, {
        success: true,
        data: {
          platforms: [
            {
              id: 'vjudge',
              name: 'VJudge',
              supported: true,
              userBindingStatus: 'bound',
              userBindingUsername: 'e2e-bound-user',
            },
          ],
        },
      })
    }
    if (url.endsWith('/groups')) {
      if (pathname.includes('/luogu/')) {
        return json(route, {
          success: true,
          data: [{ id: 'e2e-luogu-group', name: 'E2E Luogu Group' }],
        })
      }
      return json(route, {
        success: true,
        data: [{ groupId: 'e2e-group', groupName: 'E2E Group', memberCount: 2 }],
      })
    }
    if (url.endsWith('/preview')) {
      return json(route, {
        success: true,
        data: {
          groupId: 'e2e-group',
          groupName: 'E2E Imported Team',
          members: [
            {
              username: 'student1',
              nickname: 'Student One',
              studentName: 'E2E Campus Student',
              gender: 'male',
            },
          ],
        },
      })
    }
    return json(route, { success: true, data: { valid: true, teamId: 'e2e-team' } })
  })

  await page.route('**/api/oj-fetcher/**', async route => {
    const url = route.request().url()
    if (url.includes('/config')) {
      return json(route, {
        success: true,
        data: {
          platform: 'luogu',
          configured: true,
          cookieNames: ['session'],
          lastUsedAt: null,
        },
      })
    }
    if (url.includes('/jobs')) {
      return json(route, {
        success: true,
        data: { data: [], page: 1, totalPages: 1, total: 0 },
      })
    }
    return json(route, { success: true, data: {} })
  })
}
