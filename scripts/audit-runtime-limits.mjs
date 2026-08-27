import { execFileSync } from 'node:child_process'

function command(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function assert(condition, message, failures) {
  if (!condition) failures.push(message)
}

function systemdDurationToMicroseconds(value) {
  const match = String(value || '').match(/^(\d+(?:\.\d+)?)(us|ms|s|min|h)$/)
  if (!match) return Number.NaN
  const factor = { us: 1, ms: 1_000, s: 1_000_000, min: 60_000_000, h: 3_600_000_000 }[match[2]]
  return Number(match[1]) * factor
}

const failures = []
const judge = JSON.parse(command('docker', ['inspect', 'oi-judge']))[0]
const host = judge.HostConfig
const nofile = (host.Ulimits || []).find(item => item.Name === 'nofile')
const binding = host.PortBindings?.['5050/tcp']?.[0]

assert(host.Memory === 1536 * 1024 * 1024, 'go-judge memory limit must be 1536 MiB', failures)
assert(host.MemorySwap === 2 * 1024 * 1024 * 1024, 'go-judge memory+swap limit must be 2 GiB', failures)
assert(host.CpuPeriod === 100000 && host.CpuQuota === 150000, 'go-judge CPU quota must be 1.5 CPUs', failures)
assert(host.PidsLimit === 256, 'go-judge PID limit must be 256', failures)
assert(host.ReadonlyRootfs === true, 'go-judge root filesystem must be read-only', failures)
assert((host.SecurityOpt || []).includes('no-new-privileges:true'), 'go-judge must enable no-new-privileges', failures)
assert(nofile?.Soft === 65536 && nofile?.Hard === 65536, 'go-judge NOFILE limit must be 65536', failures)
assert(Boolean(host.Tmpfs?.['/tmp']), 'go-judge must use a bounded /tmp tmpfs', failures)
assert(binding?.HostIp === '127.0.0.1' && binding?.HostPort === '5050', 'go-judge must bind only to 127.0.0.1:5050', failures)
assert(host.LogConfig?.Type === 'json-file', 'go-judge must use the json-file log driver', failures)
assert(host.LogConfig?.Config?.['max-size'] === '20m' && host.LogConfig?.Config?.['max-file'] === '5', 'go-judge log rotation must be 20m × 5', failures)

const expectedUnits = {
  'oi-manager-api-router.service': { MemoryMax: 128 * 1024 * 1024, TasksMax: '128', LimitNOFILE: '65536', TimeoutStopUSec: 30_000_000 },
  'oi-manager-server@3302.service': { MemoryMax: 1024 * 1024 * 1024, TasksMax: '512', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000 },
  'oi-manager-server@3303.service': { MemoryMax: 1024 * 1024 * 1024, TasksMax: '512', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000 },
  'oi-manager-worker.service': { MemoryMax: 768 * 1024 * 1024, TasksMax: '256', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000 },
  'oi-manager-judge.service': { MemoryMax: 768 * 1024 * 1024, TasksMax: '512', LimitNOFILE: '65536', TimeoutStopUSec: 60_000_000 },
  'oi-manager-web.service': { MemoryMax: 1024 * 1024 * 1024, TasksMax: '256', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000 },
}

const units = {}
for (const [unit, expected] of Object.entries(expectedUnits)) {
  const values = Object.fromEntries(command('systemctl', [
    'show', unit,
    '--property=MemoryMax,TasksMax,LimitNOFILE,TimeoutStopUSec,StartLimitBurst,StartLimitIntervalUSec',
    '--no-pager',
  ]).split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)))
  units[unit] = values
  assert(Number(values.MemoryMax) === expected.MemoryMax, `${unit} has unexpected MemoryMax`, failures)
  assert(values.TasksMax === expected.TasksMax, `${unit} has unexpected TasksMax`, failures)
  assert(values.LimitNOFILE === expected.LimitNOFILE, `${unit} has unexpected LimitNOFILE`, failures)
  assert(systemdDurationToMicroseconds(values.TimeoutStopUSec) === expected.TimeoutStopUSec, `${unit} has unexpected TimeoutStopSec`, failures)
  assert(Number(values.StartLimitBurst) === 10, `${unit} must allow at most 10 starts per interval`, failures)
  assert(systemdDurationToMicroseconds(values.StartLimitIntervalUSec) === 60_000_000, `${unit} restart interval must be 60 seconds`, failures)
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  judge: {
    memoryBytes: host.Memory,
    memorySwapBytes: host.MemorySwap,
    cpuPeriod: host.CpuPeriod,
    cpuQuota: host.CpuQuota,
    pidsLimit: host.PidsLimit,
    readonlyRootfs: host.ReadonlyRootfs,
    noNewPrivileges: (host.SecurityOpt || []).includes('no-new-privileges:true'),
    nofile: nofile ? { soft: nofile.Soft, hard: nofile.Hard } : null,
    boundedTmpfs: Boolean(host.Tmpfs?.['/tmp']),
    loopbackPort: binding?.HostIp === '127.0.0.1',
    logRotation: host.LogConfig?.Config || {},
  },
  units,
  failures,
}, null, 2))

if (failures.length) process.exitCode = 1
