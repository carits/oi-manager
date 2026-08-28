import { Router, type NextFunction, type Response } from 'express'
import type { Problem } from '@prisma/client'
import yazl from 'yazl'
import { authenticate, type AuthRequest as MiddlewareAuthRequest } from '../middleware/auth'
import { logger } from '../lib/logger'
import {
  cleanupTestdataStaging,
  collectUploadedTestdata,
  createTestdataReadStream,
  MAX_FILE_COUNT,
  normalizeTestdataName,
  prepareTestdataUpload,
  testdataContentDisposition,
  testdataDownloadName,
  testdataFileExists,
  testdataUpload,
  type TestdataUploadRequest,
} from '../modules/testdata/testdata-storage'
import {
  authorizeTestdata,
  deleteTestdata,
  detectTestdataPairs,
  getTestdataExport,
  listTestdata,
  resolveTestdataDownload,
  TestdataApplicationError,
  uploadTestdata,
} from '../modules/testdata/application/testdata.service'

export const testdataRouter = Router()

type AuthRequest = MiddlewareAuthRequest & TestdataUploadRequest & {
  problem?: Problem
}

async function loadAuthorizedProblem(req: AuthRequest, res: Response, next: NextFunction, prepareUpload: boolean) {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'Testdata operation failed' })
    const problem = await authorizeTestdata(req.user, req.params.id)
    req.problem = problem
    if (prepareUpload) {
      const staging = prepareTestdataUpload(req.params.id)
      req.testdataUploadId = staging.uploadId
      req.testdataUploadPath = staging.uploadPath
    }
    next()
  } catch (error) {
    if (error instanceof TestdataApplicationError) {
      return res.status(error.statusCode).json({
        success: false, ...(error.code ? { code: error.code } : {}), message: error.message,
        ...(error.data !== undefined ? { data: error.data } : {}),
      })
    }
    next(error)
  }
}

const requireManage = (req: AuthRequest, res: Response, next: NextFunction) =>
  loadAuthorizedProblem(req, res, next, true)
const requireView = (req: AuthRequest, res: Response, next: NextFunction) =>
  loadAuthorizedProblem(req, res, next, false)

testdataRouter.get('/problems/:id/testdata', authenticate, requireView, async (req: AuthRequest, res) => {
  try {
    res.json({ success: true, data: await listTestdata(req.params.id) })
  } catch (error) {
    logger.error('get_testdata_error', { action: 'testdata', metadata: { error: String(error) } })
    res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.post(
  '/problems/:id/testdata', authenticate, requireManage, testdataUpload.array('files', MAX_FILE_COUNT),
  async (req: AuthRequest, res) => {
    try {
      const files = req.files as Express.Multer.File[]
      const replace = req.body?.replace === 'true'
      if (!files?.length) {
        cleanupTestdataStaging(req.testdataUploadPath)
        return res.status(400).json({ success: false, message: 'Testdata operation failed' })
      }
      const staged = await collectUploadedTestdata(files, req.testdataUploadPath!)
      if (!staged.length) {
        cleanupTestdataStaging(req.testdataUploadPath)
        return res.status(400).json({ success: false, message: 'Testdata operation failed' })
      }
      const uploaded = await uploadTestdata(req.params.id, staged, replace, req.testdataUploadPath!)
      cleanupTestdataStaging(req.testdataUploadPath)
      logger.info('testdata_uploaded', {
        action: 'testdata',
        metadata: {
          problemId: req.params.id, fileCount: uploaded.length, replace,
          files: uploaded.map(file => file.filename),
        },
      })
      res.json({ success: true, data: { files: uploaded, message: `Uploaded ${uploaded.length} testdata files` } })
    } catch (error) {
      cleanupTestdataStaging(req.testdataUploadPath)
      if (error instanceof TestdataApplicationError) {
        return res.status(error.statusCode).json({
          success: false, ...(error.code ? { code: error.code } : {}), message: error.message,
          ...(error.data !== undefined ? { data: error.data } : {}),
        })
      }
      logger.error('upload_testdata_error', { action: 'testdata', metadata: { error: String(error) } })
      res.status(400).json({ success: false, message: error instanceof Error ? error.message : 'Testdata operation failed' })
    }
  },
)

testdataRouter.delete('/problems/:id/testdata/:fileId', authenticate, requireManage, async (req: AuthRequest, res) => {
  try {
    const deleted = await deleteTestdata(req.params.id, req.params.fileId, req.testdataUploadPath!)
    logger.info('testdata_deleted', {
      action: 'testdata', metadata: { problemId: req.params.id, filename: deleted.filename },
    })
    cleanupTestdataStaging(req.testdataUploadPath)
    res.json({ success: true, message: 'Testdata file deleted' })
  } catch (error) {
    cleanupTestdataStaging(req.testdataUploadPath)
    if (error instanceof TestdataApplicationError) {
      return res.status(error.statusCode).json({
        success: false, ...(error.code ? { code: error.code } : {}), message: error.message,
        ...(error.data !== undefined ? { data: error.data } : {}),
      })
    }
    logger.error('delete_testdata_error', { action: 'testdata', metadata: { error: String(error) } })
    res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.post('/problems/:id/testdata/auto', authenticate, requireView, async (req: AuthRequest, res) => {
  try {
    res.json({ success: true, data: await detectTestdataPairs(req.params.id) })
  } catch (error) {
    logger.error('auto_detect_pairs_error', { action: 'testdata', metadata: { error: String(error) } })
    res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.get('/problems/:id/testdata/export', authenticate, requireView, async (req: AuthRequest, res) => {
  try {
    const { files, pairs } = await getTestdataExport(req.params.id)
    const zip = new yazl.ZipFile()
    zip.addBuffer(Buffer.from(JSON.stringify({
      format: 'carits-testdata', version: 1, problemId: req.problem?.problemId || req.params.id,
      internalProblemId: req.params.id, exportedAt: new Date().toISOString(),
      files: files.map(file => ({ filename: `data/${file.filename}`, size: file.size, sha256: file.sha256 || file.md5 })),
      cases: pairs.map((pair, index) => ({
        id: `case-${index + 1}`, order: index + 1,
        input: `data/${pair.input}`, output: `data/${pair.output}`,
      })),
    }, null, 2)), 'manifest.json')
    for (const file of files) {
      if (testdataFileExists(req.params.id, file.filename)) {
        zip.addReadStream(createTestdataReadStream(req.params.id, file.filename), `data/${file.filename}`)
      }
    }
    const filename = `${req.problem?.problemId || req.params.id}-testdata.zip`
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', testdataContentDisposition(filename))
    zip.outputStream.pipe(res)
    zip.end()
  } catch (error) {
    logger.error('export_testdata_error', { action: 'testdata', metadata: { error: String(error) } })
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.get('/problems/:id/testdata/files/:fileId/download', authenticate, requireView, async (req: AuthRequest, res) => {
  try {
    const file = await resolveTestdataDownload(req.params.id, { fileId: req.params.fileId })
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', testdataContentDisposition(testdataDownloadName(file.filename)))
    createTestdataReadStream(req.params.id, file.filename).pipe(res)
  } catch (error) {
    if (error instanceof TestdataApplicationError && !res.headersSent) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    logger.error('download_testdata_error', { action: 'testdata', metadata: { error: String(error) } })
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})

testdataRouter.get('/problems/:id/testdata/download/:filename', authenticate, requireView, async (req: AuthRequest, res) => {
  try {
    const filename = normalizeTestdataName(req.params.filename)
    await resolveTestdataDownload(req.params.id, { filename })
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', testdataContentDisposition(testdataDownloadName(filename)))
    createTestdataReadStream(req.params.id, filename).pipe(res)
  } catch (error) {
    if (error instanceof TestdataApplicationError && !res.headersSent) {
      return res.status(error.statusCode).json({ success: false, message: error.message })
    }
    logger.error('download_testdata_error', { action: 'testdata', metadata: { error: String(error) } })
    if (!res.headersSent) res.status(500).json({ success: false, message: 'Testdata operation failed' })
  }
})
