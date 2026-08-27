const baseUrl = process.env.GO_JUDGE_URL || 'http://127.0.0.1:5050'
const parsed = new URL(baseUrl)
if (!['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
  throw new Error('Refusing to smoke a non-loopback go-judge endpoint')
}

async function json(path, options) {
  const response = await fetch(new URL(path, baseUrl), options)
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}`)
  return response.json()
}

const version = await json('/version')
const before = Object.keys(await json('/file')).length
const marker = `oi-manager-sandbox-${process.pid}`
const result = await json('/run', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    cmd: [{
      args: ['sh', '-c', `printf %s ${marker} >stdout`],
      env: ['PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'],
      copyOut: ['stdout'],
      cpuLimit: 1_000_000_000,
      clockLimit: 3_000_000_000,
      memoryLimit: 64 * 1024 * 1024,
      procLimit: 10,
      outputLimit: 64 * 1024,
    }],
  }),
})

const command = result?.[0]
if (!command || command.status !== 'Accepted' || command.exitStatus !== 0 || command.files?.stdout !== marker) {
  throw new Error(`Unexpected sandbox result: ${JSON.stringify(command)}`)
}
const after = Object.keys(await json('/file')).length
if (after !== before) throw new Error(`go-judge file inventory leaked: ${before} -> ${after}`)

console.log(JSON.stringify({ ok: true, buildVersion: version.buildVersion, status: command.status, fileInventory: { before, after } }))
