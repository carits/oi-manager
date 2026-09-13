import dotenv from 'dotenv'
import path from 'path'

// Load deployment-specific configuration before importing modules that derive
// constants from process.env. Keeping this as the first import in index.ts
// makes bootstrap ordering explicit and deterministic.
const envFile = process.env.ENV_FILE
  || (process.env.NODE_ENV === 'production' ? '.env.production' : '.env')

dotenv.config({ path: path.resolve(process.cwd(), envFile) })
