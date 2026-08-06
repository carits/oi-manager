/**
 * Testdata management API.
 * P0 safety: permission before upload, staging before commit, no silent overwrite,
 * streaming SHA-256, single/all downloads, and safe ZIP import.
 */

import { Router, type NextFunction, type Response } from 'express'
import { authenticate } from '../middleware/auth'
import { prisma } from '../prisma'
import { logger } from '../lib/logger'
import multer from 'multer'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { canModifyProblem, canViewProblem } from '../modules/problem/problem.access'
import type { Problem } from '@prisma/client'

export const testdataRouter = Router()

const TESTDATA_DIR = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
const STAGING_DIR = path.join(TESTDATA_DIR, '.staging')
const MAX_FILE_SIZE = Number(process.env.TESTDATA_MAX_FILE_SIZE || 100 * 1024 * 1024)
const MAX_TOTAL_SIZE = Number(process.env.TESTDATA_MAX_TOTAL_SIZE || 1024 * 1024 * 1024)
const MAX_FILE_COUNT = Number(process.env.TESTDATA_MAX_FILE_COUNT || 500)
const MAX_ZIP_DEPTH = Number(process.env.TESTDATA_MAX_ZIP_DEPTH || 10)

fs.mkdirSync(TESTDATA_DIR, { recursive: true })
fs.mkdirSync(STAGING_DIR, { recursive: true })

type AuthRequest = any & {
  problem?: Problem
  testdataUploadId?: string
  testdataUploadPath?: string
}

type StagedFile = {
  filename: string
  path: string
  size: number
  sha256: string
}

async function requireTestdataManagePermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
    if (!problem || !canViewProblem(req.user, problem)) {
      return res.status(404).json({ success: false, message: 'Testdata operation failed' })
    }
    if (!canModifyProblem(req.user, problem)) {
      return res.status(403).json({ success: false, message: 'Testdata operation failed' })
    }

    req.problem = problem
    req.testdataUploadId = crypto.randomUUID()
    req.testdataUploadPath = path.join(STAGING_DIR, req.params.id, req.testdataUploadId)
    fs.mkdirSync(req.testdataUploadPath, { recursive: true })
    next()
  } catch (e) {
    next(e)
  }
}

async function requireTestdataViewPermission(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const problem = await prisma.problem.findUnique({ where: { id: req.params.id } })
    if (!problem || !canViewProblem(req.user, problem)) {
      return res.status(404).json({ success: false, message: 'Testdata operation failed' })
    }
    if (!canModifyProblem(req.user, problem)) {
      return res.status(403).json({ success: false, message: 'Testdata operation failed' })
    }

    req.problem = problem
    next()
  } catch (e) {
    next(e)
  }
}

const storage = multer.diskStorage({
  destination: (req: AuthRequest, _file, cb) => {
    if (!req.testdataUploadPath) return cb(new Error('Testdata operation failed'), '')
    fs.mkdirSync(req.testdataUploadPath, { recursive: true })
    cb(null, req.testdataUploadPath)
  },
  filename: (_req, file, cb) => {
    cb(null, `${crypto.randomUUID()}${path.extname(file.originalname || '')}`)
  },
})

const upload = multer({
  storage,
  limits: {
    files: MAX_FILE_COUNT,
    fileSize: MAX_FILE_SIZE,
  },
})

function cleanupDir(dir: string | undefined) {
  if (!dir) return
  const resolved = path.resolve(dir)
  const staging = path.resolve(STAGING_DIR)
  if (resolved === staging || !resolved.startsWith(staging + path.sep)) return
  fs.rmSync(resolved, { recursive: true, force: true })
}

function normalizeTestdataName(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.includes('\0')) throw new Error('Testdata operation failed')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new Error('Testdata operation failed')
  const parts = normalized.split('/')
  if (parts.length > MAX_ZIP_DEPTH) throw new Error('Testdata operation failed')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Testdata operation failed')
  if (parts.some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part))) throw new Error('Testdata operation failed')
  return parts.join('/')
}

function safeJoin(baseDir: string, relativeName: string): string {
  const safeName = normalizeTestdataName(relativeName)
  const resolved = path.resolve(baseDir, safeName.split('/').join(path.sep))
  const base = path.resolve(baseDir)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) throw new Error('Testdata operation failed')
  return resolved
}

function isZipFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip')
}

function streamHashFile(filePath: string, algorithm: 'sha256' | 'md5' = 'sha256'): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm)
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, strictFileNames: true }, (err, zipFile) => {
      if (err || !zipFile) return reject(err || new Error('Testdata operation failed'))
      resolve(zipFile)
    })
  })
}

function readZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (err, stream) => {
      if (err || !stream) return reject(err || new Error('Testdata operation failed'))
      resolve(stream)
    })
  })
}

function writeEntry(stream: NodeJS.ReadableStream, targetPath: string, expectedSize: number): Promise<{ size: number; sha256: string }> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    let size = 0
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    const output = fs.createWriteStream(targetPath, { flags: 'wx' })

    stream.on('data', chunk => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_FILE_SIZE) {
        (stream as any).destroy(new Error('Testdata operation failed'))
        return
      }
      hash.update(chunk)
    })
    stream.on('error', reject)
    output.on('error', reject)
    output.on('finish', () => {
      if (expectedSize >= 0 && size !== expectedSize) return reject(new Error('Testdata operation failed'))
      resolve({ size, sha256: hash.digest('hex') })
    })
    stream.pipe(output)
  })
}

async function extractZipToStaging(zipPath: string, destinationDir: string): Promise<StagedFile[]> {
  const zipFile = await openZip(zipPath)
  const files: StagedFile[] = []
  let totalSize = 0
  const seen = new Set<string>()

  return await new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      try { zipFile.close() } catch { /* ignore */ }
      reject(error)
    }

    zipFile.on('entry', async entry => {
      try {
        if (/\/$/.test(entry.fileName)) {
          zipFile.readEntry()
          return
        }

        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        if (mode === 0o120000) throw new Error('Testdata operation failed')
        if (entry.uncompressedSize > MAX_FILE_SIZE) throw new Error('Testdata operation failed')
        totalSize += entry.uncompressedSize
        if (totalSize > MAX_TOTAL_SIZE) throw new Error('Testdata operation failed')
        if (files.length >= MAX_FILE_COUNT) throw new Error('Testdata operation failed')

        const filename = normalizeTestdataName(entry.fileName)
        const lowerKey = filename.toLowerCase()
        if (seen.has(lowerKey)) throw new Error(`Testdata operation failed`)
        seen.add(lowerKey)

        const targetPath = safeJoin(destinationDir, filename)
        const stream = await readZipEntry(zipFile, entry)
        const written = await writeEntry(stream, targetPath, entry.uncompressedSize)
        files.push({ filename, path: targetPath, size: written.size, sha256: written.sha256 })
        zipFile.readEntry()
      } catch (e: any) {
        fail(e)
      }
    })

    zipFile.on('end', () => resolve(files))
    zipFile.on('error', fail)
    zipFile.readEntry()
  })
}

async function collectUploadedFiles(files: Express.Multer.File[], stagingDir: string): Promise<StagedFile[]> {
  const collected: StagedFile[] = []
  const extractedDir = path.join(stagingDir, 'extracted')
  fs.mkdirSync(extractedDir, { recursive: true })

  for (const file of files) {
    if (isZipFile(file.originalname)) {
      const extracted = await extractZipToStaging(file.path, extractedDir)
      collected.push(...extracted)
      continue
    }

    const filename = normalizeTestdataName(path.basename(file.originalname))
    const targetPath = safeJoin(extractedDir, filename)
    if (fs.existsSync(targetPath)) throw new Error(`Testdata operation failed`)
    fs.renameSync(file.path, targetPath)
    collected.push({
      filename,
      path: targetPath,
      size: file.size,
      sha256: await streamHashFile(targetPath, 'sha256'),
    })
  }

  const totalSize = collected.reduce((sum, file) => sum + file.size, 0)
  if (collected.length > MAX_FILE_COUNT) throw new Error('Testdata operation failed')
  if (totalSize > MAX_TOTAL_SIZE) throw new Error('Testdata operation failed')

  const names = new Set<string>()
  for (const file of collected) {
    const key = file.filename.toLowerCase()
    if (names.has(key)) throw new Error(`Testdata operation failed`)
    names.add(key)
  }

  return naturalSortFiles(collected)
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function naturalSortFiles<T extends { filename: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => naturalCompare(a.filename, b.filename))
}

function pairKeyFor(filename: string): { key: string; role: 'input' | 'output' } | null {
  const normalized = filename.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()
  const ext = lower.match(/\.(in|out|ans|txt)$/)?.[1]
  if (!ext) return null

  if (lower.startsWith('input/')) return { key: normalized.slice('input/'.length).replace(/\.[^.]+$/, ''), role: 'input' }
  if (lower.startsWith('output/')) return { key: normalized.slice('output/'.length).replace(/\.[^.]+$/, ''), role: 'output' }
  if (lower.startsWith('answer/')) return { key: normalized.slice('answer/'.length).replace(/\.[^.]+$/, ''), role: 'output' }
  if (ext === 'in') return { key: normalized.replace(/\.[^.]+$/, ''), role: 'input' }
  if (ext === 'out' || ext === 'ans') return { key: normalized.replace(/\.[^.]+$/, ''), role: 'output' }
  return null
}

function autoDetectPairs(filenames: string[]): Array<{ input: string; output: string }> {
  const inputs = new Map<string, string>()
  const outputs = new Map<string, string>()

  for (const filename of [...filenames].sort(naturalCompare)) {
    const pair = pairKeyFor(filename)
    if (!pair) continue
    if (pair.role === 'input' && !inputs.has(pair.key)) inputs.set(pair.key, filename)
    if (pair.role === 'output' && !outputs.has(pair.key)) outputs.set(pair.key, filename)
  }

  const pairs: Array<{ input: string; output: string }> = []
  for (const [key, input] of inputs) {
    const output = outputs.get(key)
    if (output) pairs.push({ input, output })
  }
  return pairs.sort((a, b) => naturalCompare(a.input, b.input))
}

function findUnmatchedFiles(filenames: string[], pairs: Array<{ input: string; output: string }>): string[] {
  const matched = new Set<string>()
  for (const pair of pairs) {
    matched.add(pair.input)
    matched.add(pair.output)
  }
  return filenames.filter(f => !matched.has(f)).sort(naturalCompare)
}

function contentDisposition(filename: string): string {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
}

async function commitStagedFiles(problemId: string, stagedFiles: StagedFile[]) {
  const finalDir = path.join(TESTDATA_DIR, problemId)
  fs.mkdirSync(finalDir, { recursive: true })
  const uploadedFiles = []

  for (const file of stagedFiles) {
    const targetPath = safeJoin(finalDir, file.filename)
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    fs.renameSync(file.path, targetPath)

    const existing = await prisma.testdataFile.findUnique({
      where: { problemId_filename: { problemId, filename: file.filename } },
    })

    if (existing) {
      await prisma.testdataFile.update({
        where: { id: existing.id },
        data: { size: file.size, md5: null, sha256: file.sha256, uploadedAt: new Date() },
      })
      uploadedFiles.push({ id: existing.id, filename: file.filename, size: file.size, sha256: file.sha256, status: 'updated' })
    } else {
      const testdataFile = await prisma.testdataFile.create({
        data: { id: crypto.randomUUID(), problemId, filename: file.filename, size: file.size, md5: null, sha256: file.sha256 },
      })
      uploadedFiles.push({ id: testdataFile.id, filename: file.filename, size: file.size, sha256: file.sha256, status: 'created' })
    }
  }

  return uploadedFiles
}

testdataRouter.get('/problems/:id/testdata', authenticate, requireTestdataViewPermission, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const files = await prisma.testdataFile.findMany({ where: { problemId: id }, orderBy: { filename: 'asc' } })
    const filenames = files.map(f => f.filename)
    res.json({
      success: true,
      data: {
        files: naturalSortFiles(files).map(f => ({
          id: f.id,
          filename: f.filename,
          size: f.size,
          md5: f.md5,
          sha256: f.sha256,
          uploadedAt: f.uploadedAt,
        })),
        pairs: autoDetectPairs(filenames),
      },
    })
  } catch (e: any) {
    logger.error('get_testdata_error', { action: 'testdata', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.post(
  '/problems/:id/testdata',
  authenticate,
  requireTestdataManagePermission,
  upload.array('files', MAX_FILE_COUNT),
  async (req: AuthRequest, res) => {
    try {
      const { id } = req.params
      const files = req.files as Express.Multer.File[]
      const replace = req.body?.replace === 'true'

      if (!files || files.length === 0) {
        cleanupDir(req.testdataUploadPath)
        return res.status(400).json({ success: false, message: 'Testdata operation failed' })
      }

      const stagedFiles = await collectUploadedFiles(files, req.testdataUploadPath!)
      if (stagedFiles.length === 0) {
        cleanupDir(req.testdataUploadPath)
        return res.status(400).json({ success: false, message: 'Testdata operation failed' })
      }

      const existing = await prisma.testdataFile.findMany({ where: { problemId: id } })
      const existingNames = new Set(existing.map(file => file.filename.toLowerCase()))
      const conflicts = stagedFiles.filter(file => existingNames.has(file.filename.toLowerCase())).map(file => file.filename)

      if (conflicts.length > 0 && !replace) {
        cleanupDir(req.testdataUploadPath)
        return res.status(409).json({
          success: false,
          code: 'TESTDATA_CONFLICT',
          message: 'Testdata filename conflict',
          data: {
            conflicts,
            files: stagedFiles.map(file => ({ filename: file.filename, size: file.size, sha256: file.sha256 })),
            pairs: autoDetectPairs(stagedFiles.map(file => file.filename)),
          },
        })
      }

      const uploadedFiles = await commitStagedFiles(id, stagedFiles)
      cleanupDir(req.testdataUploadPath)

      logger.info('testdata_uploaded', {
        action: 'testdata',
        metadata: { problemId: id, fileCount: uploadedFiles.length, replace, files: uploadedFiles.map(f => f.filename) },
      })

      res.json({ success: true, data: { files: uploadedFiles, message: `Uploaded ${uploadedFiles.length} testdata files` } })
    } catch (e: any) {
      cleanupDir(req.testdataUploadPath)
      logger.error('upload_testdata_error', { action: 'testdata', metadata: { error: e.message } })
      res.status(400).json({ success: false, message: e.message || 'Testdata operation failed' })
    }
  },
)

testdataRouter.delete('/problems/:id/testdata/:fileId', authenticate, requireTestdataManagePermission, async (req: AuthRequest, res) => {
  try {
    const { id, fileId } = req.params
    const testdataFile = await prisma.testdataFile.findUnique({ where: { id: fileId } })
    if (!testdataFile || testdataFile.problemId !== id) return res.status(404).json({ success: false, message: 'Testdata operation failed' })

    const filePath = safeJoin(path.join(TESTDATA_DIR, id), testdataFile.filename)
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    await prisma.testdataFile.delete({ where: { id: fileId } })

    logger.info('testdata_deleted', { action: 'testdata', metadata: { problemId: id, filename: testdataFile.filename } })
    res.json({ success: true, message: 'Testdata file deleted' })
  } catch (e: any) {
    logger.error('delete_testdata_error', { action: 'testdata', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.post('/problems/:id/testdata/auto', authenticate, requireTestdataViewPermission, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const files = await prisma.testdataFile.findMany({ where: { problemId: id }, orderBy: { filename: 'asc' } })
    const filenames = files.map(f => f.filename)
    const pairs = autoDetectPairs(filenames)
    res.json({ success: true, data: { pairs, unmatched: findUnmatchedFiles(filenames, pairs) } })
  } catch (e: any) {
    logger.error('auto_detect_pairs_error', { action: 'testdata', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.get('/problems/:id/testdata/export', authenticate, requireTestdataViewPermission, async (req: AuthRequest, res) => {
  try {
    const { id } = req.params
    const files = naturalSortFiles(await prisma.testdataFile.findMany({ where: { problemId: id }, orderBy: { filename: 'asc' } }))
    const zip = new yazl.ZipFile()
    const pairs = autoDetectPairs(files.map(file => file.filename))
    const manifest = {
      format: 'carits-testdata',
      version: 1,
      problemId: req.problem?.problemId || id,
      internalProblemId: id,
      exportedAt: new Date().toISOString(),
      files: files.map(file => ({ filename: `data/${file.filename}`, size: file.size, sha256: file.sha256 || file.md5 })),
      cases: pairs.map((pair, index) => ({ id: `case-${index + 1}`, order: index + 1, input: `data/${pair.input}`, output: `data/${pair.output}` })),
    }

    zip.addBuffer(Buffer.from(JSON.stringify(manifest, null, 2)), 'manifest.json')
    for (const file of files) {
      const filePath = safeJoin(path.join(TESTDATA_DIR, id), file.filename)
      if (fs.existsSync(filePath)) zip.addReadStream(fs.createReadStream(filePath), `data/${file.filename}`)
    }

    const filename = `${req.problem?.problemId || id}-testdata.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', contentDisposition(filename))
    zip.outputStream.pipe(res)
    zip.end()
  } catch (e: any) {
    logger.error('export_testdata_error', { action: 'testdata', metadata: { error: e.message } })
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.get('/problems/:id/testdata/files/:fileId/download', authenticate, requireTestdataViewPermission, async (req: AuthRequest, res) => {
  try {
    const { id, fileId } = req.params
    const testdataFile = await prisma.testdataFile.findUnique({ where: { id: fileId } })
    if (!testdataFile || testdataFile.problemId !== id) return res.status(404).json({ success: false, message: 'Testdata operation failed' })

    const filePath = safeJoin(path.join(TESTDATA_DIR, id), testdataFile.filename)
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'Testdata operation failed' })

    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', contentDisposition(path.basename(testdataFile.filename)))
    fs.createReadStream(filePath).pipe(res)
  } catch (e: any) {
    logger.error('download_testdata_error', { action: 'testdata', metadata: { error: e.message } })
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

// Compatibility route for old callers. New UI should use fileId downloads.
testdataRouter.get('/problems/:id/testdata/download/:filename', authenticate, requireTestdataViewPermission, async (req: AuthRequest, res) => {
  try {
    const { id, filename } = req.params
    const safeFilename = normalizeTestdataName(filename)
    const testdataFile = await prisma.testdataFile.findUnique({ where: { problemId_filename: { problemId: id, filename: safeFilename } } })
    if (!testdataFile) return res.status(404).json({ success: false, message: 'Testdata operation failed' })

    const filePath = safeJoin(path.join(TESTDATA_DIR, id), safeFilename)
    if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, message: 'Testdata operation failed' })
    res.download(filePath, path.basename(safeFilename))
  } catch (e: any) {
    logger.error('download_testdata_error', { action: 'testdata', metadata: { error: e.message } })
    res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})
