/**
 * 统一日志模块
 *
 * 提供结构化日志输出，支持请求追踪和审计日志
 */

export interface LogMetadata {
  requestId?: string
  userId?: string
  role?: string
  action?: string
  target?: string
  [key: string]: any
}

export interface LogEntry {
  timestamp: string
  level: 'info' | 'warn' | 'error'
  message: string
  requestId?: string
  userId?: string
  role?: string
  action?: string
  target?: string
  metadata?: Record<string, any>
  error?: {
    name: string
    message: string
    stack?: string
  }
}

/**
 * 格式化日志条目为 JSON 字符串
 */
function formatLog(entry: LogEntry): string {
  return JSON.stringify(entry)
}

/**
 * 获取当前 ISO 时间戳
 */
function getTimestamp(): string {
  return new Date().toISOString()
}

/**
 * 日志级别
 */
type LogLevel = 'info' | 'warn' | 'error'

/**
 * 判断是否应该输出日志
 * 开发环境输出所有级别，生产环境可配置
 */
function shouldLog(level: LogLevel): boolean {
  const logLevel = process.env.LOG_LEVEL || 'info'
  const levels: LogLevel[] = ['info', 'warn', 'error']
  const configLevelIndex = levels.indexOf(logLevel as LogLevel)
  const currentLevelIndex = levels.indexOf(level)
  return currentLevelIndex >= configLevelIndex
}

/**
 * 输出日志到控制台
 */
function outputLog(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return

  const formatted = formatLog(entry)

  switch (entry.level) {
    case 'error':
      console.error(formatted)
      break
    case 'warn':
      console.warn(formatted)
      break
    default:
      console.log(formatted)
  }
}

/**
 * 统一日志对象
 */
export const logger = {
  /**
   * 记录信息日志
   */
  info(message: string, metadata?: LogMetadata): void {
    const entry: LogEntry = {
      timestamp: getTimestamp(),
      level: 'info',
      message,
      ...metadata
    }
    outputLog(entry)
  },

  /**
   * 记录警告日志
   */
  warn(message: string, metadata?: LogMetadata): void {
    const entry: LogEntry = {
      timestamp: getTimestamp(),
      level: 'warn',
      message,
      ...metadata
    }
    outputLog(entry)
  },

  /**
   * 记录错误日志
   */
  error(message: string, error?: Error | unknown, metadata?: LogMetadata): void {
    const entry: LogEntry = {
      timestamp: getTimestamp(),
      level: 'error',
      message,
      ...metadata
    }

    if (error instanceof Error) {
      entry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    } else if (error) {
      entry.error = {
        name: 'UnknownError',
        message: String(error)
      }
    }

    outputLog(entry)
  },

  /**
   * 记录审计日志（用于关键操作追踪）
   */
  audit(action: string, metadata: LogMetadata): void {
    const entry: LogEntry = {
      timestamp: getTimestamp(),
      level: 'info',
      message: 'audit',
      action,
      ...metadata
    }
    outputLog(entry)
  },

  /**
   * 记录安全日志（用于权限拒绝等安全事件）
   */
  security(event: string, metadata: LogMetadata): void {
    const entry: LogEntry = {
      timestamp: getTimestamp(),
      level: 'warn',
      message: 'security',
      action: event,
      ...metadata
    }
    outputLog(entry)
  }
}

/**
 * 创建请求级别的日志上下文
 */
export function createRequestLogger(requestId: string, userId?: string, role?: string) {
  return {
    info(message: string, metadata?: Omit<LogMetadata, 'requestId' | 'userId' | 'role'>): void {
      logger.info(message, { requestId, userId, role, ...metadata })
    },

    warn(message: string, metadata?: Omit<LogMetadata, 'requestId' | 'userId' | 'role'>): void {
      logger.warn(message, { requestId, userId, role, ...metadata })
    },

    error(message: string, error?: Error | unknown, metadata?: Omit<LogMetadata, 'requestId' | 'userId' | 'role'>): void {
      logger.error(message, error, { requestId, userId, role, ...metadata })
    },

    audit(action: string, metadata?: Omit<LogMetadata, 'requestId' | 'userId' | 'role'>): void {
      logger.audit(action, { requestId, userId, role, ...metadata })
    },

    security(event: string, metadata?: Omit<LogMetadata, 'requestId' | 'userId' | 'role'>): void {
      logger.security(event, { requestId, userId, role, ...metadata })
    }
  }
}

export default logger
