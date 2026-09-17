import { TelemetryContracts, type EndpointBody } from '@oi-manager/contracts'
import { apiClient } from '@/lib/apiClient'

export function reportClientError(body: EndpointBody<typeof TelemetryContracts.clientError>) {
  return apiClient.mutateContract(TelemetryContracts.clientError, '/api/telemetry/client-errors', body, {
    anonymous: true, credentials: 'omit', keepalive: true, timeout: 2000,
  })
}
