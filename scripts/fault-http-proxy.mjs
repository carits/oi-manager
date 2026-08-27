import http from 'node:http'

const listenPort = Number(process.env.FAULT_PROXY_PORT || 15052)
const upstreamPort = Number(process.env.FAULT_PROXY_UPSTREAM_PORT || 15053)
if (!Number.isSafeInteger(listenPort) || !Number.isSafeInteger(upstreamPort)) {
  throw new Error('FAULT_PROXY_PORT and FAULT_PROXY_UPSTREAM_PORT must be integers')
}

let resetNext = 0
const server = http.createServer((request, response) => {
  if (request.url === '/__fault/next-reset' && request.method === 'POST') {
    resetNext++
    response.writeHead(204).end()
    return
  }
  if (request.url === '/__fault/status') {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ resetNext, upstreamPort }))
    return
  }
  if (resetNext > 0 && request.url?.startsWith('/run')) {
    resetNext--
    request.socket.destroy()
    return
  }
  const upstream = http.request({
    host: '127.0.0.1', port: upstreamPort, method: request.method,
    path: request.url, headers: request.headers,
  }, upstreamResponse => {
    response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers)
    upstreamResponse.pipe(response)
  })
  upstream.on('error', error => {
    if (!response.headersSent) response.writeHead(502)
    response.end(error.message)
  })
  request.pipe(upstream)
})

server.listen(listenPort, '127.0.0.1', () => {
  console.log(`Fault proxy listening on 127.0.0.1:${listenPort}, upstream ${upstreamPort}`)
})
const shutdown = () => server.close(() => process.exit(0))
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
