import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { STORAGE_ROOT } from '../../../config/storage'

const temporaryDirectory = path.join(STORAGE_ROOT, 'temp/uploads')
fs.mkdirSync(temporaryDirectory, { recursive: true })

export const genericFileUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, temporaryDirectory),
    filename: (_req, file, callback) => callback(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`,
    ),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
})

export function cleanupGenericTemporaryFile(file?: Express.Multer.File) {
  if (!file?.path) return
  try { fs.rmSync(file.path, { force: true }) } catch { /* best effort */ }
}
