// 修复负责人角色不一致的问题
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function fixPrincipalRoles() {
  console.log('开始修复负责人角色...\n')

  try {
    // 1. 获取所有学校及其负责人教师ID
    const schools = await prisma.school.findMany({
      where: {
        currentPrincipalTeacherId: { not: null }
      },
      select: {
        id: true,
        name: true,
        currentPrincipalTeacherId: true
      }
    })

    console.log(`找到 ${schools.length} 个有负责人的学校`)

    // 2. 获取这些负责人的教师信息
    const principalTeacherIds = schools.map(s => s.currentPrincipalTeacherId).filter(Boolean)
    const principalTeachers = await prisma.teacher.findMany({
      where: {
        id: { in: principalTeacherIds }
      },
      include: {
        user: true
      }
    })

    console.log(`找到 ${principalTeachers.length} 个负责人教师记录\n`)

    // 3. 检查并修复：应该是 school_principal 但不是的
    console.log('=== 需要修复为 school_principal 的用户 ===')
    let fixedCount = 0
    for (const teacher of principalTeachers) {
      if (teacher.user.role !== 'school_principal') {
        const school = schools.find(s => s.currentPrincipalTeacherId === teacher.id)
        console.log(`  ${teacher.user.username} (${teacher.name}) at ${school?.name}`)
        console.log(`    当前角色: ${teacher.user.role} -> 修改为: school_principal`)

        await prisma.user.update({
          where: { id: teacher.userId },
          data: { role: 'school_principal' }
        })
        fixedCount++
      }
    }
    console.log(`修复了 ${fixedCount} 个用户\n`)

    // 4. 获取所有 user.role = school_principal 的用户
    const allPrincipalUsers = await prisma.user.findMany({
      where: { role: 'school_principal' },
      include: {
        teacher: true
      }
    })

    console.log('=== 需要修复为 teacher 的用户 ===')
    let revertedCount = 0
    for (const user of allPrincipalUsers) {
      if (user.teacher) {
        // 检查这个教师是否是某个学校的负责人
        const isPrincipal = principalTeacherIds.includes(user.teacher.id)
        if (!isPrincipal) {
          console.log(`  ${user.username} (${user.teacher.name})`)
          console.log(`    当前角色: school_principal -> 修改为: teacher`)

          await prisma.user.update({
            where: { id: user.id },
            data: { role: 'teacher' }
          })
          revertedCount++
        }
      }
    }
    console.log(`修复了 ${revertedCount} 个用户\n`)

    console.log('✓ 修复完成！')
  } catch (error) {
    console.error('修复失败:', error)
  } finally {
    await prisma.$disconnect()
  }
}

fixPrincipalRoles()
