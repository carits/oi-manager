import './load-env'
import { Agent, setGlobalDispatcher } from 'undici'
import { createApplication } from './app'
import { validateEnv } from './config/env'
import { proxyManager } from './lib/browser/proxy'
import { startServerRuntime } from './server-runtime'

setGlobalDispatcher(new Agent({ connect: { timeout: 30_000 } }))
validateEnv()
proxyManager.loadFromEnv()

const app = createApplication()
const httpServer = startServerRuntime(app)

export { app, httpServer }
export default app
