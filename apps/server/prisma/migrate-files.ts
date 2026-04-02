/**
 * 文件迁移脚本
 * 将现有文件迁移到新的目录结构并创建 File 记录
 *
 * 使用方法：npx tsx prisma/migrate-files.ts
 */

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { prisma } from '../src/prisma'

// 旧上传目录
const OLD_UPLOADS_DIR = path.join(__dirname, '../uploads')
// 新存储根目录
const STORAGE_ROOT = OLD_UPLOADS_DIR

// 新目录结构
const NEW_DIRS = {
  public: {
    avatars: 'public/avatars',
    problemImages: 'public/problem-images',
    contestAssets: 'public/contest-assets'
  },
  private: {
    problemPdfs: 'private/problem-pdfs',
    problemAttachments: 'private/problem-attachments',
    contestAttachments: 'private/contest-attachments',
    teamAttachments: 'private/team-attachments',
    exports: 'private/exports'
  }
}

// 获取文件 MD5
function calculateMd5(filePath: string): string {
  const buffer = fs.readFileSync(filePath)
  return crypto.createHash('md5').update(buffer).digest('hex')
}

// 获取文件 MIME 类型
function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.md': 'text/markdown',
    '.in': 'text/plain',
    '.ans': 'text/plain',
    '.out': 'text/plain'
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

// 确保目录存在
function ensureDir(dir: string) {
  const fullPath = path.join(STORAGE_ROOT, dir)
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true })
  }
}

async function migrateFiles() {
  console.log('开始迁移文件...\n')

  // 1. 迁移用户头像 (User.avatar, Teacher.avatar, Student.avatar)
  console.log('1. 迁移用户头像...')
  const users = await prisma.user.findMany({
    where: { avatar: { not: null } },
    select: { id: true, avatar: true }
  })

  for (const user of users) {
    if (!user.avatar) continue

    // 解析旧路径
    const oldPath = user.avatar.replace('/uploads/', '')
    const fullOldPath = path.join(STORAGE_ROOT, oldPath)

    if (!fs.existsSync(fullOldPath)) {
      console.log(`  文件不存在: ${fullOldPath}`)
      continue
    }

    // 获取文件信息
    const filename = path.basename(oldPath)
    const ext = path.extname(filename)
    const newFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    const newRelativePath = NEW_DIRS.public.avatars + '/users'

    ensureDir(newRelativePath)

    // 复制到新位置
    const newFullPath = path.join(STORAGE_ROOT, newRelativePath, newFilename)
    fs.copyFileSync(fullOldPath, newFullPath)

    // 创建 File 记录
    const file = await prisma.file.create({
      data: {
        storageType: 'local',
        disk: 'default',
        relativePath: newRelativePath,
        fileName: newFilename,
        originalName: filename,
        mimeType: getMimeType(filename),
        fileSize: fs.statSync(newFullPath).size,
        md5Hash: calculateMd5(newFullPath),
        accessLevel: 'public',
        isPublic: true,
        ownerType: 'user',
        ownerId: user.id,
        category: 'avatar',
        status: 'active'
      }
    })

    // 更新 User.avatar 为新的 File ID
    await prisma.user.update({
      where: { id: user.id },
      data: { avatar: `/api/files/${file.id}/public` }
    })

    console.log(`  迁移用户头像: ${filename} -> ${file.id}`)
  }

  // 2. 迁移教师头像
  const teachers = await prisma.teacher.findMany({
    where: { avatar: { not: null } },
    select: { id: true, avatar: true }
  })

  for (const teacher of teachers) {
    if (!teacher.avatar) continue

    const oldPath = teacher.avatar.replace('/uploads/', '')
    const fullOldPath = path.join(STORAGE_ROOT, oldPath)

    if (!fs.existsSync(fullOldPath)) {
      console.log(`  文件不存在: ${fullOldPath}`)
      continue
    }

    const filename = path.basename(oldPath)
    const ext = path.extname(filename)
    const newFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    const newRelativePath = NEW_DIRS.public.avatars + '/teachers'

    ensureDir(newRelativePath)

    const newFullPath = path.join(STORAGE_ROOT, newRelativePath, newFilename)
    fs.copyFileSync(fullOldPath, newFullPath)

    const file = await prisma.file.create({
      data: {
        storageType: 'local',
        disk: 'default',
        relativePath: newRelativePath,
        fileName: newFilename,
        originalName: filename,
        mimeType: getMimeType(filename),
        fileSize: fs.statSync(newFullPath).size,
        md5Hash: calculateMd5(newFullPath),
        accessLevel: 'public',
        isPublic: true,
        ownerType: 'user',
        ownerId: teacher.id,
        category: 'avatar',
        status: 'active'
      }
    })

    await prisma.teacher.update({
      where: { id: teacher.id },
      data: { avatar: `/api/files/${file.id}/public` }
    })

    console.log(`  迁移教师头像: ${filename} -> ${file.id}`)
  }

  // 3. 迁移学生头像
  const students = await prisma.student.findMany({
    where: { avatar: { not: null } },
    select: { id: true, avatar: true }
  })

  for (const student of students) {
    if (!student.avatar) continue

    const oldPath = student.avatar.replace('/uploads/', '')
    const fullOldPath = path.join(STORAGE_ROOT, oldPath)

    if (!fs.existsSync(fullOldPath)) {
      console.log(`  文件不存在: ${fullOldPath}`)
      continue
    }

    const filename = path.basename(oldPath)
    const ext = path.extname(filename)
    const newFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    const newRelativePath = NEW_DIRS.public.avatars + '/students'

    ensureDir(newRelativePath)

    const newFullPath = path.join(STORAGE_ROOT, newRelativePath, newFilename)
    fs.copyFileSync(fullOldPath, newFullPath)

    const file = await prisma.file.create({
      data: {
        storageType: 'local',
        disk: 'default',
        relativePath: newRelativePath,
        fileName: newFilename,
        originalName: filename,
        mimeType: getMimeType(filename),
        fileSize: fs.statSync(newFullPath).size,
        md5Hash: calculateMd5(newFullPath),
        accessLevel: 'public',
        isPublic: true,
        ownerType: 'user',
        ownerId: student.id,
        category: 'avatar',
        status: 'active'
      }
    })

    await prisma.student.update({
      where: { id: student.id },
      data: { avatar: `/api/files/${file.id}/public` }
    })

    console.log(`  迁移学生头像: ${filename} -> ${file.id}`)
  }

  // 4. 迁移团队头像
  const teams = await prisma.team.findMany({
    where: { avatar: { not: null } },
    select: { id: true, avatar: true }
  })

  for (const team of teams) {
    if (!team.avatar) continue

    const oldPath = team.avatar.replace('/uploads/', '')
    const fullOldPath = path.join(STORAGE_ROOT, oldPath)

    if (!fs.existsSync(fullOldPath)) {
      console.log(`  文件不存在: ${fullOldPath}`)
      continue
    }

    const filename = path.basename(oldPath)
    const ext = path.extname(filename)
    const newFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    const newRelativePath = NEW_DIRS.public.avatars + '/teams'

    ensureDir(newRelativePath)

    const newFullPath = path.join(STORAGE_ROOT, newRelativePath, newFilename)
    fs.copyFileSync(fullOldPath, newFullPath)

    const file = await prisma.file.create({
      data: {
        storageType: 'local',
        disk: 'default',
        relativePath: newRelativePath,
        fileName: newFilename,
        originalName: filename,
        mimeType: getMimeType(filename),
        fileSize: fs.statSync(newFullPath).size,
        md5Hash: calculateMd5(newFullPath),
        accessLevel: 'public',
        isPublic: true,
        ownerType: 'team',
        ownerId: team.id,
        category: 'avatar',
        status: 'active'
      }
    })

    await prisma.team.update({
      where: { id: team.id },
      data: { avatar: `/api/files/${file.id}/public` }
    })

    console.log(`  迁移团队头像: ${filename} -> ${file.id}`)
  }

  // 5. 迁移题目 PDF
  console.log('\n2. 迁移题目 PDF...')
  const problems = await prisma.problem.findMany({
    where: {
      OR: [
        { statementPdfUrl: { not: null } },
        { solutionPdfUrl: { not: null } }
      ]
    },
    select: { id: true, statementPdfUrl: true, solutionPdfUrl: true, ownerId: true }
  })

  for (const problem of problems) {
    // 迁移题面 PDF
    if (problem.statementPdfUrl) {
      const oldPath = problem.statementPdfUrl.replace('/uploads/', '')
      const fullOldPath = path.join(STORAGE_ROOT, oldPath)

      if (fs.existsSync(fullOldPath)) {
        const filename = path.basename(oldPath)
        const ext = path.extname(filename)
        const newFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
        const newRelativePath = NEW_DIRS.private.problemPdfs

        ensureDir(newRelativePath)

        const newFullPath = path.join(STORAGE_ROOT, newRelativePath, newFilename)
        fs.copyFileSync(fullOldPath, newFullPath)

        const file = await prisma.file.create({
          data: {
            storageType: 'local',
            disk: 'default',
            relativePath: newRelativePath,
            fileName: newFilename,
            originalName: filename,
            mimeType: getMimeType(filename),
            fileSize: fs.statSync(newFullPath).size,
            md5Hash: calculateMd5(newFullPath),
            accessLevel: 'private',
            isPublic: false,
            ownerType: 'problem',
            ownerId: problem.id,
            category: 'pdf',
            status: 'active'
          }
        })

        await prisma.problem.update({
          where: { id: problem.id },
          data: { statementPdfUrl: `/api/files/${file.id}/download` }
        })

        console.log(`  迁移题面 PDF: ${filename} -> ${file.id}`)
      }
    }

    // 迁移题解 PDF
    if (problem.solutionPdfUrl) {
      const oldPath = problem.solutionPdfUrl.replace('/uploads/', '')
      const fullOldPath = path.join(STORAGE_ROOT, oldPath)

      if (fs.existsSync(fullOldPath)) {
        const filename = path.basename(oldPath)
        const ext = path.extname(filename)
        const newFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
        const newRelativePath = NEW_DIRS.private.problemPdfs

        ensureDir(newRelativePath)

        const newFullPath = path.join(STORAGE_ROOT, newRelativePath, newFilename)
        fs.copyFileSync(fullOldPath, newFullPath)

        const file = await prisma.file.create({
          data: {
            storageType: 'local',
            disk: 'default',
            relativePath: newRelativePath,
            fileName: newFilename,
            originalName: filename,
            mimeType: getMimeType(filename),
            fileSize: fs.statSync(newFullPath).size,
            md5Hash: calculateMd5(newFullPath),
            accessLevel: 'private',
            isPublic: false,
            ownerType: 'problem',
            ownerId: problem.id,
            category: 'pdf',
            status: 'active'
          }
        })

        await prisma.problem.update({
          where: { id: problem.id },
          data: { solutionPdfUrl: `/api/files/${file.id}/download` }
        })

        console.log(`  迁移题解 PDF: ${filename} -> ${file.id}`)
      }
    }
  }

  // 6. 迁移题目附件
  console.log('\n3. 迁移题目附件...')
  const attachments = await prisma.problemAttachment.findMany({
    select: { id: true, problemId: true, fileName: true, fileUrl: true }
  })

  for (const attachment of attachments) {
    const oldPath = attachment.fileUrl.replace('/uploads/', '')
    const fullOldPath = path.join(STORAGE_ROOT, oldPath)

    if (!fs.existsSync(fullOldPath)) {
      console.log(`  文件不存在: ${fullOldPath}`)
      continue
    }

    const filename = attachment.fileName || path.basename(oldPath)
    const ext = path.extname(filename)
    const newFilename = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`
    const newRelativePath = NEW_DIRS.private.problemAttachments

    ensureDir(newRelativePath)

    const newFullPath = path.join(STORAGE_ROOT, newRelativePath, newFilename)
    fs.copyFileSync(fullOldPath, newFullPath)

    const file = await prisma.file.create({
      data: {
        storageType: 'local',
        disk: 'default',
        relativePath: newRelativePath,
        fileName: newFilename,
        originalName: filename,
        mimeType: getMimeType(filename),
        fileSize: fs.statSync(newFullPath).size,
        md5Hash: calculateMd5(newFullPath),
        accessLevel: 'private',
        isPublic: false,
        ownerType: 'problem',
        ownerId: attachment.problemId,
        category: 'attachment',
        status: 'active'
      }
    })

    await prisma.problemAttachment.update({
      where: { id: attachment.id },
      data: { fileUrl: `/api/files/${file.id}/download` }
    })

    console.log(`  迁移题目附件: ${filename} -> ${file.id}`)
  }

  console.log('\n文件迁移完成！')
  console.log('\n注意：旧文件仍保留在原位置，请手动验证后删除。')
}

migrateFiles()
  .catch(console.error)
  .finally(() => prisma.$disconnect())