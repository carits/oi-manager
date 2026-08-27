#!/usr/bin/env node
import fs from 'node:fs'
import http from 'node:http'

const host = process.env.API_ROUTER_HOST || '127.0.0.1'
const port = Number.parseInt(process.env.API_ROUTER_PORT || '3002', 10)
const activeFile = process.env.API_ACTIVE_UPSTREAM_FILE || '/data/oi-manager-response-refactor/.run/api-active-upstream'
const startupReadyFile = process.env.API_STARTUP_READY_FILE || ''
const allowedUpstreams = new Set((process.env.API_ALLOWED_UPSTREAMS || '3302,3303')
  .split(',')
  .map(value => Number.parseInt(value.trim(), 10))
  .filter(value => Number.isSafeInteger(value) && value > 0 && value <= 65535))
if (allowedUpstreams.size === 0) throw new Error('API_ALLOWED_UPSTREAMS must contain at least one valid port')

function activePort() {
  const value = fs.readFileSync(activeFile, 'utf8').trim()
  const target = Number.parseInt(value, 10)
  if (!allowedUpstreams.has(target)) throw new Error(`Invalid API upstream: ${value}`)
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

function destroyQuietly(stream, error) {
  if (!stream || stream.destroyed) return
  stream.destroy(error)
}

function endSocket(socket, statusLine) {
  if (!socket || socket.destroyed) return
  if (socket.writable) socket.end(`${statusLine}\r\nConnection: close\r\n\r\n`)
  else destroyQuietly(socket)
}

const server = http.createServer((req, res) => {
  if (startupReadyFile && !fs.existsSync(startupReadyFile)) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'retry-after': '1' })
    return res.end(JSON.stringify({ success: false, message: 'API router stack is starting' }))
  }
  let upstream
  try { upstream = http.request(proxyOptions(req), proxy => {
    proxy.on('error', error => destroyQuietly(upstream, error))
    res.writeHead(proxy.statusCode || 502, proxy.statusMessage, proxy.headers)
    proxy.pipe(res)
  }) } catch (error) {
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ success: false, message: error.message }))
  }
  upstream.on('error', error => {
    if (res.destroyed || res.writableEnded) return
    if (!res.headersSent) {
      res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, message: 'API upstream unavailable' }))
    } else {
      destroyQuietly(res, error)
    }
  })
  req.once('aborted', () => destroyQuietly(upstream))
  req.once('error', error => destroyQuietly(upstream, error))
  res.once('error', error => destroyQuietly(upstream, error))
  res.once('close', () => {
    if (!res.writableEnded) destroyQuietly(upstream)
  })
  req.pipe(upstream)
})

server.on('upgrade', (req, socket, head) => {
  let upstream
  try { upstream = http.request(proxyOptions(req)) } catch {
    endSocket(socket, 'HTTP/1.1 503 Service Unavailable')
    return
  }
  upstream.on('upgrade', (response, upstreamSocket, upstreamHead) => {
    const headers = Object.entries(response.headers)
      .flatMap(([key, value]) => Array.isArray(value) ? value.map(item => `${key}: ${item}`) : value == null ? [] : [`${key}: ${value}`])
    socket.write(`HTTP/1.1 ${response.statusCode || 101} ${response.statusMessage || 'Switching Protocols'}\r\n${headers.join('\r\n')}\r\n\r\n`)
    if (head.length) upstreamSocket.write(head)
    if (upstreamHead.length) socket.write(upstreamHead)
    socket.on('error', error => destroyQuietly(upstreamSocket, error))
    upstreamSocket.on('error', error => destroyQuietly(socket, error))
    socket.once('close', () => destroyQuietly(upstreamSocket))
    upstreamSocket.once('close', () => destroyQuietly(socket))
    upstreamSocket.pipe(socket).pipe(upstreamSocket)
  })
  upstream.on('response', response => {
    response.resume()
    endSocket(socket, `HTTP/1.1 ${response.statusCode || 502} ${response.statusMessage || 'Bad Gateway'}`)
  })
  upstream.on('error', () => endSocket(socket, 'HTTP/1.1 502 Bad Gateway'))
  socket.on('error', error => destroyQuietly(upstream, error))
  socket.once('close', () => destroyQuietly(upstream))
  upstream.end()
})

server.on('clientError', (_error, socket) => endSocket(socket, 'HTTP/1.1 400 Bad Request'))

const connections = new Set()
server.on('connection', socket => {
  connections.add(socket)
  socket.once('close', () => connections.delete(socket))
  // A client reset is a transport event, not a process-fatal exception.
  socket.on('error', () => {})
})

server.listen(port, host, () => process.stdout.write(`API router listening on ${host}:${port}\n`))

function shutdown() {
  server.close(() => process.exit(0))
  for (const socket of connections) destroyQuietly(socket)
  setTimeout(() => process.exit(0), 5_000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
