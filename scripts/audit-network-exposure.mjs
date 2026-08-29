#!/usr/bin/env node
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'

const restrictedPorts = new Set([3002, 3302, 3303, 5050, 5432])

function parseEndpoint(value) {
  const match = value.match(/^(.+):(\d+)$/)
  if (!match) return null
  return { host: match[1].replace(/^\[|\]$/g, ''), port: Number(match[2]) }
}

function isLoopback(host) {
  return host === '::1' || host === 'localhost' || host.startsWith('127.')
}

export function auditListeners(text, allowedPublicPorts) {
  const listeners = []
  const violations = []
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields.length < 5 || fields[0] !== 'LISTEN') continue
    const endpoint = parseEndpoint(fields[3])
    if (!endpoint) continue
    listeners.push(endpoint)
    if (restrictedPorts.has(endpoint.port) && !isLoopback(endpoint.host)) {
      violations.push(`restricted port ${endpoint.port} listens on ${endpoint.host}`)
    } else if (!isLoopback(endpoint.host) && !allowedPublicPorts.has(endpoint.port)) {
      violations.push(`unexpected public listener ${endpoint.host}:${endpoint.port}`)
    }
  }
  return { listeners, violations }
}

const allowed = new Set(
  (process.env.NETWORK_PUBLIC_PORTS || '22,80,443,3000')
    .split(',')
    .map(value => Number(value.trim()))
    .filter(Number.isInteger),
)
const input = process.env.NETWORK_AUDIT_INPUT_FILE
  ? fs.readFileSync(process.env.NETWORK_AUDIT_INPUT_FILE, 'utf8')
  : execFileSync('ss', ['-H', '-ltn'], { encoding: 'utf8' })
const result = auditListeners(input, allowed)
console.log(JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  allowedPublicPorts: [...allowed].sort((a, b) => a - b),
  listenerCount: result.listeners.length,
  violations: result.violations,
}, null, 2))
if (result.violations.length) process.exitCode = 1
