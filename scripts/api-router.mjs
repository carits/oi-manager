#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'

const host = process.env.API_ROUTER_HOST || '127.0.0.1'
const port = Number.parseInt(process.env.API_ROUTER_PORT || '3002', 10)
const activeFile = process.env.API_ACTIVE_UPSTREAM_FILE || '/data/oi-manager-response-refactor/.run/api-active-upstream'

function activePort() {
  const value = fs.readFileSync(activeFile, 'utf8').trim()
  const target = Number.parseInt(value, 10)
  if (![3302, 3303].includes(target)) throw new Error(`Invalid API upstream: ${value}`)
  return target
}

function proxyOptions(req) {
  return {
    host: '127.0.0.1',
    port: activePort(),
    method: req.method,
    path: req.url,
    headers: { ...req.headers, host: req.headers.host || `127.0.0.1:${port}` },
  }
}

const server = http.createServer((req, res) => {
  let upstream
  try { upstream = http.request(proxyOptions(req), proxy => {
    res.writeHead(proxy.statusCode || 502, proxy.statusMessage, proxy.headers)
    proxy.pipe(res)
  }) } catch (error) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ success: false, message: error.message }))
  }
  upstream.on('error', error => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, message: 'API upstream unavailable', detail: error.message }))
  })
  req.pipe(upstream)
})

server.on('upgrade', (req, socket, head) => {
  let upstream
  try { upstream = http.request(proxyOptions(req)) } catch {
    socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n')
    return
  }
  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    const headers = Object.entries(response.headers)
      .flatMap(([key, value]) => Array.isArray(value) ? value.map(item => `${key}: ${item}`) : value == null ? [] : [`${key}: ${value}`])
    socket.write(`HTTP/1.1 ${response.statusCode || 101} ${response.statusMessage || 'Switching Protocols'}\r\n${headers.join('\r\n')}\r\n\r\n`)
    if (head.length) upstreamSocket.write(head)
    if (upstreamHead.length) socket.write(upstreamHead)
    upstreamSocket.pipe(socket).pipe(upstreamSocket)
  })
  upstream.on('response', response => {
    socket.end(`HTTP/1.1 ${response.statusCode || 502} ${response.statusMessage || 'Bad Gateway'}\r\nConnection: close\r\n\r\n`)
  })
  upstream.on('error', () => socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'))
  upstream.end()
})

server.listen(port, host, () => process.stdout.write(`API router listening on ${host}:${port}\n`))

function shutdown() { server.close(() => process.exit(0)) }
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
