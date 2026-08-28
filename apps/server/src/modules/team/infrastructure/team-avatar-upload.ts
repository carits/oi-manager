import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { STORAGE_ROOT } from '../../../config/storage'

const temporaryDirectory = path.join(STORAGE_ROOT, 'temp/uploads')
fs.mkdirSync(temporaryDirectory, { recursive: true })

export const teamAvatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, temporaryDirectory),
    filename: (_req, file, callback) => callback(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`,
    ),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase()
    const valid = ['.jpeg', '.jpg', '.png', '.gif', '.webp'].includes(extension)
      && ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(file.mimetype)
    if (valid) callback(null, true)
    else callback(new Error('只支持图片文件'))
  },
})

export function cleanupTeamAvatarTemporaryFile(file?: Express.Multer.File) {
  if (!file?.path) return
  try { fs.rmSync(file.path, { force: true }) } catch { /* best effort */ }
}
