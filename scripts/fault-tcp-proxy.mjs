import http from 'node:http'
import net from 'node:net'

const listenPort = Number(process.env.FAULT_TCP_PROXY_PORT || 15432)
const upstreamPort = Number(process.env.FAULT_TCP_UPSTREAM_PORT || 15433)
const controlPort = Number(process.env.FAULT_TCP_CONTROL_PORT || 15434)
let unavailableUntil = 0
const sockets = new Set()

const server = net.createServer(client => {
  if (Date.now() < unavailableUntil) {
    client.destroy()
    return
  }
  const upstream = net.createConnection({ host: '127.0.0.1', port: upstreamPort })
  sockets.add(client)
  sockets.add(upstream)
  const cleanup = () => { sockets.delete(client); sockets.delete(upstream) }
  client.on('close', cleanup)
  upstream.on('close', cleanup)
  client.on('error', () => upstream.destroy())
  upstream.on('error', () => client.destroy())
  client.pipe(upstream)
  upstream.pipe(client)
})

const control = http.createServer((request, response) => {
  const url = new URL(request.url || '/', `http://127.0.0.1:${controlPort}`)
  if (url.pathname === '/__fault/drop' && request.method === 'POST') {
    const durationMs = Math.min(15_000, Math.max(100, Number(url.searchParams.get('ms') || 3000)))
    unavailableUntil = Date.now() + durationMs
    for (const socket of sockets) socket.destroy()
    response.writeHead(204).end()
    return
  }
  response.setHeader('content-type', 'application/json')
  response.end(JSON.stringify({ unavailableUntil, activeSockets: sockets.size, upstreamPort }))
})

server.listen(listenPort, '127.0.0.1')
control.listen(controlPort, '127.0.0.1', () => {
  console.log(`TCP fault proxy ${listenPort} -> ${upstreamPort}, control ${controlPort}`)
})
const shutdown = () => {
  for (const socket of sockets) socket.destroy()
  control.close()
  server.close(() => process.exit(0))
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
