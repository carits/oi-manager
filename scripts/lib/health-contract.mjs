export function assertHealthContract(payload, source = 'health endpoint') {
  if (!payload || typeof payload !== 'object') throw new Error(`${source} did not return an object`)
  if (payload.schemaVersion !== 1) throw new Error(`${source} has unsupported schemaVersion`)
  if (payload.status !== 'ok' || payload.service !== 'api' || payload.success !== true) {
    throw new Error(`${source} is not healthy`)
  }
  if (typeof payload.timestamp !== 'string' || Number.isNaN(Date.parse(payload.timestamp))) {
    throw new Error(`${source} has an invalid timestamp`)
  }
  return payload
}

export function assertReadinessContract(payload, source = 'readiness endpoint') {
  if (!payload || typeof payload !== 'object') throw new Error(`${source} did not return an object`)
  if (payload.schemaVersion !== 1 || payload.service !== 'api') {
    throw new Error(`${source} has an unsupported contract`)
  }
  if (!['ready', 'not_ready'].includes(payload.status)) throw new Error(`${source} has an invalid status`)
  if (payload.dependencies?.database?.status !== payload.status) {
    throw new Error(`${source} database status does not match readiness`)
  }
  return payload
}
