import { HEALTH_CONTRACT_VERSION, type ReadinessResponse } from '@oi-manager/contracts'
import { prisma } from '../../prisma'

export async function resolveReadiness(): Promise<{ statusCode: 200 | 503; response: ReadinessResponse }> {
  const startedAt = performance.now()
  try {
    await prisma.$queryRaw`SELECT 1 AS ready`
    return {
      statusCode: 200,
      response: {
        schemaVersion: HEALTH_CONTRACT_VERSION,
        status: 'ready',
        service: 'api',
        timestamp: new Date().toISOString(),
        dependencies: {
          database: {
            status: 'ready',
            latencyMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
          },
        },
      },
    }
  } catch {
    return {
      statusCode: 503,
      response: {
        schemaVersion: HEALTH_CONTRACT_VERSION,
        status: 'not_ready',
        service: 'api',
        timestamp: new Date().toISOString(),
        dependencies: {
          database: {
            status: 'not_ready',
            latencyMs: Math.max(0, Math.round((performance.now() - startedAt) * 10) / 10),
          },
        },
      },
    }
  }
}
