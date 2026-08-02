/**
 * Problem Module - Helper Functions
 * 题目模块辅助函数
 */

import { prisma } from '../../prisma'
export { canModifyProblem } from './problem.access'

/**
 * 生成 Carits 平台题号（纯数字，从 1000 开始原子递增）
 *
 * 使用 CaritsSequence 单行表做原子自增，避免并发竞争。
 * 首次调用时自动初始化序列行。
 */
export async function generateCaritsProblemId(): Promise<string> {
  // 确保序列行存在
  let seq = await (prisma as any).carits_sequence.findFirst()
  if (!seq) {
    seq = await (prisma as any).carits_sequence.create({ data: { nextId: 1000 } })
  }

  // 原子递增：读取当前 nextId 并 +1
  const updated = await (prisma as any).carits_sequence.update({
    where: { id: seq.id },
    data: { nextId: seq.nextId + 1 }
  })

  return String(seq.nextId)
}

/**
 * 获取当前用户的 ownerId 和 ownerType
 * ownerId 统一使用 userId，不再区分角色
 */
export async function getOwnerInfo(userId: string, role: string): Promise<{ ownerId: string; ownerType: string } | null> {
  let ownerType = 'teacher'
  if (role === 'student') {
    ownerType = 'student'
  } else if (role === 'super_admin' || role === 'platform_admin') {
    ownerType = 'admin'
  }
  return { ownerId: userId, ownerType }
}

/**
 * 检查是否有权限编辑/删除题目
 * super_admin 和 platform_admin 可以管理所有题目
 * 其他用户只能管理自己创建的题目
 */
