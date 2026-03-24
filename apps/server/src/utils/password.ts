import bcrypt from 'bcryptjs'
import crypto from 'crypto'

/**
 * 生成安全的随机临时密码
 * 12 字符（16进制），包含字母和数字
 */
export function generateTempPassword(): string {
  return crypto.randomBytes(8).toString('hex')
}

/**
 * 生成密码哈希
 * @param password 明文密码
 * @returns bcrypt 哈希值
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10)
}

/**
 * 验证密码
 * @param password 明文密码
 * @param hash 存储的哈希值
 * @returns 是否匹配
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}