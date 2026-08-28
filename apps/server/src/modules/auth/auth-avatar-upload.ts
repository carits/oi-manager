import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { STORAGE_ROOT } from '../../config/storage'

const tempAvatarDir = path.join(STORAGE_ROOT, 'temp/uploads')
fs.mkdirSync(tempAvatarDir, { recursive: true })

export const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => callback(null, tempAvatarDir),
    filename: (_req, file, callback) => callback(
      null,
      `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`,
    ),
  }),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowed = /^(image\/)?(jpeg|jpg|png|gif|webp)$/i
    const extension = path.extname(file.originalname).slice(1)
    if (allowed.test(file.mimetype) && allowed.test(extension)) callback(null, true)
    else callback(new Error('只支持图片文件'))
  },
})

export function cleanupAvatarTemporaryFile(file?: Express.Multer.File) {
  if (!file?.path) return
  try { fs.rmSync(file.path, { force: true }) } catch { /* best effort */ }
}
