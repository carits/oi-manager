import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

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
const warnings = []
const requireMonitorSuccess = process.env.RUNTIME_AUDIT_REQUIRE_MONITOR_SUCCESS !== '0'
const judge = JSON.parse(command('docker', ['inspect', 'oi-judge']))[0]
const database = JSON.parse(command('docker', ['inspect', 'oi-postgres']))[0]
const host = judge.HostConfig
const nofile = (host.Ulimits || []).find(item => item.Name === 'nofile')
const binding = host.PortBindings?.['5050/tcp']?.[0]

assert(host.Memory === 1536 * 1024 * 1024, 'go-judge memory limit must be 1536 MiB', failures)
const swapAccountingSupported = fs.existsSync('/sys/fs/cgroup/memory/memory.memsw.limit_in_bytes')
if (swapAccountingSupported) {
  assert(host.MemorySwap === 2 * 1024 * 1024 * 1024, 'go-judge memory+swap limit must be 2 GiB', failures)
} else {
  warnings.push('Host kernel does not expose cgroup v1 swap accounting; the 1536 MiB memory limit is enforced but memory+swap cannot be limited separately')
}
assert(host.CpuPeriod === 100000 && host.CpuQuota === 150000, 'go-judge CPU quota must be 1.5 CPUs', failures)
assert(host.PidsLimit === 256, 'go-judge PID limit must be 256', failures)
assert(host.ReadonlyRootfs === true, 'go-judge root filesystem must be read-only', failures)
assert((host.SecurityOpt || []).includes('no-new-privileges:true'), 'go-judge must enable no-new-privileges', failures)
assert(nofile?.Soft === 65536 && nofile?.Hard === 65536, 'go-judge NOFILE limit must be 65536', failures)
assert(Boolean(host.Tmpfs?.['/tmp']), 'go-judge must use a bounded /tmp tmpfs', failures)
assert(binding?.HostIp === '127.0.0.1' && binding?.HostPort === '5050', 'go-judge must bind only to 127.0.0.1:5050', failures)
assert(host.LogConfig?.Type === 'json-file', 'go-judge must use the json-file log driver', failures)
assert(host.LogConfig?.Config?.['max-size'] === '20m' && host.LogConfig?.Config?.['max-file'] === '5', 'go-judge log rotation must be 20m × 5', failures)
assert(database.HostConfig?.RestartPolicy?.Name === 'unless-stopped', 'PostgreSQL must restart automatically after a host reboot', failures)
assert(host.RestartPolicy?.Name === 'unless-stopped', 'go-judge must restart automatically after a host reboot', failures)

const expectedUnits = {
  'oi-manager-api-router.service': { MemoryMax: 128 * 1024 * 1024, TasksMax: '128', LimitNOFILE: '65536', TimeoutStopUSec: 30_000_000 },
  'oi-manager-server@3302.service': { MemoryMax: 1024 * 1024 * 1024, TasksMax: '512', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000, requires: 'docker.service', preStartMode: 'database' },
  'oi-manager-server@3303.service': { MemoryMax: 1024 * 1024 * 1024, TasksMax: '512', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000, requires: 'docker.service', preStartMode: 'database' },
  'oi-manager-worker.service': { MemoryMax: 768 * 1024 * 1024, TasksMax: '256', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000, requires: 'docker.service', preStartMode: 'database' },
  'oi-manager-executor@1.service': { MemoryMax: 768 * 1024 * 1024, TasksMax: '256', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000, requires: 'docker.service', preStartMode: 'database' },
  'oi-manager-judge.service': { MemoryMax: 768 * 1024 * 1024, TasksMax: '512', LimitNOFILE: '65536', TimeoutStopUSec: 60_000_000, requires: 'docker.service', preStartMode: 'judge' },
  'oi-manager-web.service': { MemoryMax: 1024 * 1024 * 1024, TasksMax: '256', LimitNOFILE: '65536', TimeoutStopUSec: 45_000_000 },
}

const units = {}
for (const [unit, expected] of Object.entries(expectedUnits)) {
  const values = Object.fromEntries(command('systemctl', [
    'show', unit,
    '--property=MemoryMax,TasksMax,LimitNOFILE,TimeoutStopUSec,StartLimitBurst,StartLimitIntervalUSec,Requires,ExecStartPre',
    '--no-pager',
  ]).split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)))
  units[unit] = values
  assert(Number(values.MemoryMax) === expected.MemoryMax, `${unit} has unexpected MemoryMax`, failures)
  assert(values.TasksMax === expected.TasksMax, `${unit} has unexpected TasksMax`, failures)
  assert(values.LimitNOFILE === expected.LimitNOFILE, `${unit} has unexpected LimitNOFILE`, failures)
  assert(systemdDurationToMicroseconds(values.TimeoutStopUSec) === expected.TimeoutStopUSec, `${unit} has unexpected TimeoutStopSec`, failures)
  assert(Number(values.StartLimitBurst) === 10, `${unit} must allow at most 10 starts per interval`, failures)
  assert(systemdDurationToMicroseconds(values.StartLimitIntervalUSec) === 60_000_000, `${unit} restart interval must be 60 seconds`, failures)
  if (expected.requires) assert(values.Requires?.split(/\s+/).includes(expected.requires), `${unit} must require ${expected.requires}`, failures)
  if (expected.preStartMode) {
    assert(
      values.ExecStartPre?.includes('/scripts/wait-runtime-dependencies.sh') && values.ExecStartPre?.includes(` ${expected.preStartMode}`),
      `${unit} must wait for ${expected.preStartMode} runtime dependencies`,
      failures,
    )
  }
}

const operationService = Object.fromEntries(command('systemctl', [
  'show', 'oi-manager-operations@monitor.service',
  '--property=MemoryMax,TasksMax,LimitNOFILE,TimeoutStartUSec,NoNewPrivileges,User,Group,Result,Requires,Wants',
  '--no-pager',
]).split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)))
assert(Number(operationService.MemoryMax) === 1536 * 1024 * 1024, 'operation tasks must have a 1536 MiB memory limit', failures)
assert(operationService.TasksMax === '512', 'operation tasks must have TasksMax=512', failures)
assert(operationService.LimitNOFILE === '65536', 'operation tasks must have LimitNOFILE=65536', failures)
assert(systemdDurationToMicroseconds(operationService.TimeoutStartUSec) === 7_200_000_000, 'operation tasks must have a two-hour timeout', failures)
assert(operationService.NoNewPrivileges === 'yes', 'operation tasks must enable NoNewPrivileges', failures)
assert(operationService.User === 'ecs-user' && operationService.Group === 'ecs-user', 'operation tasks must run as ecs-user', failures)
if (requireMonitorSuccess) {
  assert(operationService.Result === 'success', 'the latest monitor operation must have succeeded', failures)
} else if (operationService.Result !== 'success') {
  warnings.push('Latest monitor result is not success; result verification was intentionally deferred for the security-baseline self-check')
}
assert(!operationService.Requires?.split(/\s+/).includes('docker.service'), 'monitor operations must still run when Docker is down', failures)
assert(operationService.Wants?.split(/\s+/).includes('docker.service'), 'operation tasks should order Docker startup without requiring it', failures)

const expectedOperationTimers = {
  'oi-manager-monitor.timer': 'oi-manager-operations@monitor.service',
  'oi-manager-backup-db.timer': 'oi-manager-operations@backup-db.service',
  'oi-manager-backup-assets.timer': 'oi-manager-operations@backup-assets.service',
  'oi-manager-verify-db.timer': 'oi-manager-operations@verify-db.service',
  'oi-manager-verify-assets.timer': 'oi-manager-operations@verify-assets.service',
  'oi-manager-security-baseline.timer': 'oi-manager-operations@security-baseline.service',
}
const operationTimers = {}
for (const [timer, trigger] of Object.entries(expectedOperationTimers)) {
  const values = Object.fromEntries(command('systemctl', [
    'show', timer,
    '--property=ActiveState,UnitFileState,Persistent,Triggers,NextElapseUSecRealtime,NextElapseUSecMonotonic',
    '--no-pager',
  ]).split('\n').filter(Boolean).map(line => line.split(/=(.*)/s).slice(0, 2)))
  operationTimers[timer] = values
  assert(values.ActiveState === 'active', `${timer} must be active`, failures)
  assert(values.UnitFileState === 'enabled', `${timer} must be enabled`, failures)
  assert(values.Persistent === 'yes', `${timer} must be persistent`, failures)
  assert(values.Triggers?.split(/\s+/).includes(trigger), `${timer} must trigger ${trigger}`, failures)
  assert(Boolean(values.NextElapseUSecRealtime || values.NextElapseUSecMonotonic), `${timer} must have a next scheduled run`, failures)
}

console.log(JSON.stringify({
  ok: failures.length === 0,
  judge: {
    memoryBytes: host.Memory,
    memorySwapBytes: host.MemorySwap,
    swapAccountingSupported,
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
  database: {
    restartPolicy: database.HostConfig?.RestartPolicy?.Name || null,
  },
  units,
  operationService,
  requireMonitorSuccess,
  operationTimers,
  failures,
  warnings,
}, null, 2))

if (failures.length) process.exitCode = 1
