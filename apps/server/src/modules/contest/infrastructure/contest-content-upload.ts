import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { STORAGE_ROOT } from '../../../config/storage'

const tempUploadDir = path.join(STORAGE_ROOT, 'temp/uploads')
fs.mkdirSync(tempUploadDir, { recursive: true })

export const contestContentPdfUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tempUploadDir),
    filename: (_req, file, callback) => callback(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`,
    ),
  }),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const valid = file.mimetype === 'application/pdf'
      && path.extname(file.originalname).toLowerCase() === '.pdf'
    if (valid) callback(null, true)
    else callback(new Error('只支持 PDF 文件'))
  },
})

export function cleanupContestContentTemporaryFile(file?: Express.Multer.File) {
  if (!file?.path) return
  try { fs.rmSync(file.path, { force: true }) } catch { /* best effort */ }
}
