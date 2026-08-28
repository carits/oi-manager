import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import multer from 'multer'
import type { Request } from 'express'
import yauzl from 'yauzl'

export const TESTDATA_DIR = process.env.TESTDATA_DIR || path.join(process.cwd(), 'testdata')
const STAGING_DIR = path.join(TESTDATA_DIR, '.staging')
const MAX_FILE_SIZE = Number(process.env.TESTDATA_MAX_FILE_SIZE || 100 * 1024 * 1024)
const MAX_TOTAL_SIZE = Number(process.env.TESTDATA_MAX_TOTAL_SIZE || 1024 * 1024 * 1024)
export const MAX_FILE_COUNT = Number(process.env.TESTDATA_MAX_FILE_COUNT || 500)
const MAX_ZIP_DEPTH = Number(process.env.TESTDATA_MAX_ZIP_DEPTH || 10)

fs.mkdirSync(TESTDATA_DIR, { recursive: true })
fs.mkdirSync(STAGING_DIR, { recursive: true })

export type TestdataUploadRequest = Request & {
  testdataUploadId?: string
  testdataUploadPath?: string
}

export type StagedTestdataFile = {
  filename: string
  path: string
  size: number
  sha256: string
}

export function prepareTestdataUpload(problemId: string) {
  const uploadId = crypto.randomUUID()
  const uploadPath = path.join(STAGING_DIR, problemId, uploadId)
  fs.mkdirSync(uploadPath, { recursive: true })
  return { uploadId, uploadPath }
}

const storage = multer.diskStorage({
  destination: (req: TestdataUploadRequest, _file, callback) => {
    if (!req.testdataUploadPath) return callback(new Error('Testdata operation failed'), '')
    fs.mkdirSync(req.testdataUploadPath, { recursive: true })
    callback(null, req.testdataUploadPath)
  },
  filename: (_req, file, callback) => {
    callback(null, `${crypto.randomUUID()}${path.extname(file.originalname || '')}`)
  },
})

export const testdataUpload = multer({
  storage,
  limits: { files: MAX_FILE_COUNT, fileSize: MAX_FILE_SIZE },
})

export function cleanupTestdataStaging(dir: string | undefined) {
  if (!dir) return
  const resolved = path.resolve(dir)
  const staging = path.resolve(STAGING_DIR)
  if (resolved === staging || !resolved.startsWith(staging + path.sep)) return
  fs.rmSync(resolved, { recursive: true, force: true })
}

export function normalizeTestdataName(input: string): string {
  const normalized = input.replace(/\\/g, '/').replace(/^\.\//, '')
  if (!normalized || normalized.includes('\0')) throw new Error('Testdata operation failed')
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) throw new Error('Testdata operation failed')
  const parts = normalized.split('/')
  if (parts.length > MAX_ZIP_DEPTH) throw new Error('Testdata operation failed')
  if (parts.some(part => !part || part === '.' || part === '..')) throw new Error('Testdata operation failed')
  if (parts.some(part => /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(part))) {
    throw new Error('Testdata operation failed')
  }
  return parts.join('/')
}

export function safeTestdataJoin(baseDir: string, relativeName: string): string {
  const safeName = normalizeTestdataName(relativeName)
  const resolved = path.resolve(baseDir, safeName.split('/').join(path.sep))
  const base = path.resolve(baseDir)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) throw new Error('Testdata operation failed')
  return resolved
}

function streamHashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, autoClose: true, strictFileNames: true }, (error, zipFile) => {
      if (error || !zipFile) return reject(error || new Error('Testdata operation failed'))
      resolve(zipFile)
    })
  })
}

function readZipEntry(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<NodeJS.ReadableStream> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error || new Error('Testdata operation failed'))
      resolve(stream)
    })
  })
}

function writeEntry(stream: NodeJS.ReadableStream, targetPath: string, expectedSize: number) {
  return new Promise<{ size: number; sha256: string }>((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    let size = 0
    fs.mkdirSync(path.dirname(targetPath), { recursive: true })
    const output = fs.createWriteStream(targetPath, { flags: 'wx' })
    stream.on('data', chunk => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_FILE_SIZE) return (stream as any).destroy(new Error('Testdata operation failed'))
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

async function extractZip(zipPath: string, destinationDir: string): Promise<StagedTestdataFile[]> {
  const zipFile = await openZip(zipPath)
  const files: StagedTestdataFile[] = []
  let totalSize = 0
  const seen = new Set<string>()
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      try { zipFile.close() } catch { /* ignore */ }
      reject(error)
    }
    zipFile.on('entry', async entry => {
      try {
        if (/\/$/.test(entry.fileName)) return zipFile.readEntry()
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000
        if (mode === 0o120000 || entry.uncompressedSize > MAX_FILE_SIZE) throw new Error('Testdata operation failed')
        totalSize += entry.uncompressedSize
        if (totalSize > MAX_TOTAL_SIZE || files.length >= MAX_FILE_COUNT) throw new Error('Testdata operation failed')
        const filename = normalizeTestdataName(entry.fileName)
        const key = filename.toLowerCase()
        if (seen.has(key)) throw new Error('Testdata operation failed')
        seen.add(key)
        const targetPath = safeTestdataJoin(destinationDir, filename)
        const written = await writeEntry(await readZipEntry(zipFile, entry), targetPath, entry.uncompressedSize)
        files.push({ filename, path: targetPath, ...written })
        zipFile.readEntry()
      } catch (error) {
        fail(error instanceof Error ? error : new Error('Testdata operation failed'))
      }
    })
    zipFile.on('end', () => resolve(files))
    zipFile.on('error', fail)
    zipFile.readEntry()
  })
}

export async function collectUploadedTestdata(
  files: Express.Multer.File[],
  stagingDir: string,
): Promise<StagedTestdataFile[]> {
  const collected: StagedTestdataFile[] = []
  const extractedDir = path.join(stagingDir, 'extracted')
  fs.mkdirSync(extractedDir, { recursive: true })
  for (const file of files) {
    if (file.originalname.toLowerCase().endsWith('.zip')) {
      collected.push(...await extractZip(file.path, extractedDir))
      continue
    }
    const filename = normalizeTestdataName(path.basename(file.originalname))
    const targetPath = safeTestdataJoin(extractedDir, filename)
    if (fs.existsSync(targetPath)) throw new Error('Testdata operation failed')
    fs.renameSync(file.path, targetPath)
    collected.push({ filename, path: targetPath, size: file.size, sha256: await streamHashFile(targetPath) })
  }
  if (collected.length > MAX_FILE_COUNT || collected.reduce((sum, file) => sum + file.size, 0) > MAX_TOTAL_SIZE) {
    throw new Error('Testdata operation failed')
  }
  const names = new Set<string>()
  for (const file of collected) {
    const key = file.filename.toLowerCase()
    if (names.has(key)) throw new Error('Testdata operation failed')
    names.add(key)
  }
  return naturalSortTestdata(collected)
}

export function naturalCompareTestdata(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

export function naturalSortTestdata<T extends { filename: string }>(files: T[]): T[] {
  return [...files].sort((a, b) => naturalCompareTestdata(a.filename, b.filename))
}

function pairKey(filename: string): { key: string; role: 'input' | 'output' } | null {
  const normalized = filename.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()
  const ext = lower.match(/\.(in|out|ans|txt)$/)?.[1]
  if (!ext) return null
  if (lower.startsWith('input/')) return { key: normalized.slice(6).replace(/\.[^.]+$/, ''), role: 'input' }
  if (lower.startsWith('output/')) return { key: normalized.slice(7).replace(/\.[^.]+$/, ''), role: 'output' }
  if (lower.startsWith('answer/')) return { key: normalized.slice(7).replace(/\.[^.]+$/, ''), role: 'output' }
  if (ext === 'in') return { key: normalized.replace(/\.[^.]+$/, ''), role: 'input' }
  if (ext === 'out' || ext === 'ans') return { key: normalized.replace(/\.[^.]+$/, ''), role: 'output' }
  return null
}

export function autoDetectTestdataPairs(filenames: string[]) {
  const inputs = new Map<string, string>()
  const outputs = new Map<string, string>()
  for (const filename of [...filenames].sort(naturalCompareTestdata)) {
    const pair = pairKey(filename)
    if (!pair) continue
    const target = pair.role === 'input' ? inputs : outputs
    if (!target.has(pair.key)) target.set(pair.key, filename)
  }
  return [...inputs].flatMap(([key, input]) => outputs.has(key) ? [{ input, output: outputs.get(key)! }] : [])
    .sort((a, b) => naturalCompareTestdata(a.input, b.input))
}

export function unmatchedTestdataFiles(filenames: string[], pairs: Array<{ input: string; output: string }>) {
  const matched = new Set(pairs.flatMap(pair => [pair.input, pair.output]))
  return filenames.filter(filename => !matched.has(filename)).sort(naturalCompareTestdata)
}

export function testdataProblemDir(problemId: string) {
  return path.join(TESTDATA_DIR, problemId)
}

export function testdataFilePath(problemId: string, filename: string) {
  return safeTestdataJoin(testdataProblemDir(problemId), filename)
}

export function promoteStagedTestdata(problemId: string, file: StagedTestdataFile) {
  const target = testdataFilePath(problemId, file.filename)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(file.path, target)
  return target
}

export function testdataFileExists(problemId: string, filename: string) {
  return fs.existsSync(testdataFilePath(problemId, filename))
}

export function removeTestdataFile(problemId: string, filename: string) {
  const filePath = testdataFilePath(problemId, filename)
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
}

function backupPath(stagingDir: string, filename: string) {
  const digest = crypto.createHash('sha256').update(filename).digest('hex')
  const dir = path.join(stagingDir, '.rollback')
  fs.mkdirSync(dir, { recursive: true })
  return path.join(dir, digest)
}

export function copyTestdataBackup(problemId: string, filename: string, stagingDir: string) {
  const source = testdataFilePath(problemId, filename)
  if (!fs.existsSync(source)) return null
  const backup = backupPath(stagingDir, filename)
  fs.copyFileSync(source, backup, fs.constants.COPYFILE_EXCL)
  return backup
}

export function moveTestdataToBackup(problemId: string, filename: string, stagingDir: string) {
  const source = testdataFilePath(problemId, filename)
  if (!fs.existsSync(source)) return null
  const backup = backupPath(stagingDir, filename)
  fs.renameSync(source, backup)
  return backup
}

export function restoreTestdataBackup(problemId: string, filename: string, backup: string | null) {
  const target = testdataFilePath(problemId, filename)
  if (fs.existsSync(target)) fs.unlinkSync(target)
  if (!backup || !fs.existsSync(backup)) return
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.renameSync(backup, target)
}

export function createTestdataReadStream(problemId: string, filename: string) {
  return fs.createReadStream(testdataFilePath(problemId, filename))
}

export function testdataDownloadName(filename: string) {
  return path.basename(filename)
}

export function testdataContentDisposition(filename: string) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
}
