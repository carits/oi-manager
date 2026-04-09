/**
 * AES-256-CBC 加密解密工具
 * 用于 OJ 平台账号密码加密存储
 */

import crypto from 'crypto'

const ALGORITHM = 'aes-256-cbc'
const KEY_LENGTH = 32 // 256 bits

/**
 * 获取加密密钥
 * 优先从环境变量读取，否则使用开发默认值
 */
function getEncryptKey(): Buffer {
  const envKey = process.env.ACCOUNT_ENCRYPT_KEY
  if (envKey) {
    const buf = Buffer.from(envKey, 'hex')
    if (buf.length !== KEY_LENGTH) {
      throw new Error(`ACCOUNT_ENCRYPT_KEY must be ${KEY_LENGTH} bytes (64 hex chars)`)
    }
    return buf
  }
  // 开发默认密钥（生产环境必须配置环境变量）
  return Buffer.from('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'hex')
}

/**
 * AES-256-CBC 加密
 * @returns { encrypted: hex string, iv: hex string }
 */
export function encrypt(plaintext: string): { encrypted: string; iv: string } {
  const key = getEncryptKey()
  const iv = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  let encrypted = cipher.update(plaintext, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return { encrypted, iv: iv.toString('hex') }
}

/**
 * AES-256-CBC 解密
 */
export function decrypt(encrypted: string, ivHex: string): string {
  const key = getEncryptKey()
  const iv = Buffer.from(ivHex, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}
