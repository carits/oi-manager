import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { STORAGE_ROOT } from '../../../config/storage'

const tempUploadDir = path.join(STORAGE_ROOT, 'temp/uploads')
fs.mkdirSync(tempUploadDir, { recursive: true })

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, tempUploadDir),
  filename: (_req, file, callback) => {
    const suffix = `${Date.now()}-${Math.round(Math.random() * 1E9)}`
    callback(null, suffix + path.extname(file.originalname))
  },
})

export const problemPdfUpload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const valid = path.extname(file.originalname).toLowerCase() === '.pdf' && file.mimetype === 'application/pdf'
    if (valid) callback(null, true)
    else callback(new Error('只支持 PDF 文件'))
  },
})

export const problemAttachmentUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const valid = /\.(pdf|zip|rar|7z|txt|cpp|c|py|java|pas|in|out|md)$/i.test(path.extname(file.originalname))
    if (valid) callback(null, true)
    else callback(new Error('不支持的文件类型'))
  },
})
