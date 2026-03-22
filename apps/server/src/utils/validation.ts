/**
 * 验证工具函数
 */

/**
 * 验证用户名格式
 * 规则：只能包含数字、英文字母和下划线，长度 3-20 位
 */
export function validateUsername(username: string): { valid: boolean; message?: string } {
  if (!username) {
    return { valid: false, message: '用户名不能为空' }
  }

  if (username.length < 3 || username.length > 20) {
    return { valid: false, message: '用户名长度必须在 3-20 位之间' }
  }

  const usernameRegex = /^[a-zA-Z0-9_]+$/
  if (!usernameRegex.test(username)) {
    return { valid: false, message: '用户名只能包含数字、英文字母和下划线' }
  }

  return { valid: true }
}

/**
 * 验证手机号格式
 * 规则：11 位数字，以 1 开头
 */
export function validatePhone(phone: string): { valid: boolean; message?: string } {
  if (!phone) {
    return { valid: true } // 手机号可选
  }

  const phoneRegex = /^1\d{10}$/
  if (!phoneRegex.test(phone)) {
    return { valid: false, message: '手机号格式不正确，应为 11 位数字且以 1 开头' }
  }

  return { valid: true }
}

/**
 * 验证邮箱格式
 */
export function validateEmail(email: string): { valid: boolean; message?: string } {
  if (!email) {
    return { valid: true } // 邮箱可选
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    return { valid: false, message: '邮箱格式不正确' }
  }

  return { valid: true }
}

/**
 * 验证密码格式
 * 规则：至少 6 位
 */
export function validatePassword(password: string): { valid: boolean; message?: string } {
  if (!password) {
    return { valid: false, message: '密码不能为空' }
  }

  if (password.length < 6) {
    return { valid: false, message: '密码长度至少为 6 位' }
  }

  return { valid: true }
}
