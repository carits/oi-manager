import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import { validateUploadedFileContent } from '../../../lib/file-security'

const TESTDATA_ROOT = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
const temporaryDirectory = path.join(TESTDATA_ROOT, 'tmp-checkers')
fs.mkdirSync(temporaryDirectory, { recursive: true })

const checkerExtensions = new Set(['.cpp', '.cc', '.cxx'])

export const problemCheckerUpload = multer({
  dest: temporaryDirectory,
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase()
    if (checkerExtensions.has(extension)) callback(null, true)
    else callback(new Error('Checker only supports .cpp, .cc, and .cxx source files; testlib.h is provided by the system'))
  },
})

export function cleanupProblemCheckerTemporaryFile(file?: Express.Multer.File) {
  if (!file?.path) return
  try { fs.rmSync(file.path, { force: true }) } catch { /* best effort */ }
}

function checkerDirectory(problemId: string) {
  const root = path.resolve(TESTDATA_ROOT)
  const directory = path.resolve(root, problemId)
  const relative = path.relative(root, directory)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error('Invalid checker directory')
  }
  return directory
}

export function normalizeCheckerFileName(value: string) {
  const fileName = path.basename(value)
  if (!fileName || !checkerExtensions.has(path.extname(fileName).toLowerCase())) {
    throw new Error('Checker only supports .cpp, .cc, and .cxx source files; testlib.h is provided by the system')
  }
  return fileName
}

export function resolveCheckerDownload(problemId: string, requestedName: string) {
  const fileName = normalizeCheckerFileName(requestedName)
  const target = path.join(checkerDirectory(problemId), fileName)
  return fs.existsSync(target) ? { path: target, fileName } : null
}

export function prepareCheckerInstallation(problemId: string, upload: Express.Multer.File) {
  const fileName = normalizeCheckerFileName(upload.originalname)
  const source = fs.readFileSync(upload.path)
  validateUploadedFileContent(source, fileName)
  const directory = checkerDirectory(problemId)
  fs.mkdirSync(directory, { recursive: true })
  const target = path.join(directory, fileName)
  const suffix = crypto.randomUUID()
  const staged = path.join(directory, `.${fileName}.${suffix}.pending`)
  const backup = path.join(directory, `.${fileName}.${suffix}.backup`)
  fs.renameSync(upload.path, staged)
  let hasBackup = false
  try {
    if (fs.existsSync(target)) {
      fs.renameSync(target, backup)
      hasBackup = true
    }
    fs.renameSync(staged, target)
  } catch (error) {
    fs.rmSync(staged, { force: true })
    if (hasBackup && fs.existsSync(backup)) fs.renameSync(backup, target)
    throw error
  }
  let settled = false
  return {
    fileName,
    fileSize: source.length,
    language: path.extname(fileName).slice(1),
    commit() {
      if (settled) return
      settled = true
      fs.rmSync(backup, { force: true })
    },
    rollback() {
      if (settled) return
      settled = true
      fs.rmSync(target, { force: true })
      if (hasBackup && fs.existsSync(backup)) fs.renameSync(backup, target)
    },
  }
}

export function prepareCheckerRemoval(problemId: string, fileNameValue: string) {
  const fileName = normalizeCheckerFileName(fileNameValue)
  const target = path.join(checkerDirectory(problemId), fileName)
  const staged = path.join(checkerDirectory(problemId), `.${fileName}.${crypto.randomUUID()}.deleted`)
  const existed = fs.existsSync(target)
  if (existed) fs.renameSync(target, staged)
  let settled = false
  return {
    commit() {
      if (settled) return
      settled = true
      fs.rmSync(staged, { force: true })
    },
    rollback() {
      if (settled) return
      settled = true
      if (existed && fs.existsSync(staged)) fs.renameSync(staged, target)
    },
  }
}
