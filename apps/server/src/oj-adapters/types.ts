/**
 * OJ 远程题目拉取 - 类型定义
 * @description 定义 OJ 平台适配器的统一接口和数据结构
 */

/**
 * 所有已知的 OJ 平台标识列表（供白名单验证和前端下拉使用）
 * 注意：有 adapter 实现的只是其中一小部分（目前仅 luogu）
 */
export const KNOWN_OJ_PLATFORMS = [
  { value: 'poj', label: 'POJ' },
  { value: 'zoj', label: 'ZOJ' },
  { value: 'uva', label: 'UVA' },
  { value: 'livearchive', label: 'Live Archive' },
  { value: 'sgu', label: 'SGU' },
  { value: 'ural', label: 'URAL' },
  { value: 'hust', label: 'HUST' },
  { value: 'spoj', label: 'SPOJ' },
  { value: 'hdu', label: 'HDU' },
  { value: 'hysbz', label: 'HYSBZ' },
  { value: 'codeforces', label: 'CodeForces' },
  { value: 'gym', label: 'Gym' },
  { value: 'z-trening', label: 'Z-Trening' },
  { value: 'aizu', label: 'Aizu' },
  { value: 'lightoj', label: 'LightOJ' },
  { value: 'uestc', label: 'UESTC' },
  { value: 'nbut', label: 'NBUT' },
  { value: 'fzu', label: 'FZU' },
  { value: 'csu', label: 'CSU' },
  { value: 'scu', label: 'SCU' },
  { value: 'acdream', label: 'ACdream' },
  { value: 'codechef', label: 'CodeChef' },
  { value: 'openj_bailian', label: 'OpenJudge 百炼' },
  { value: 'openj_noi', label: 'OpenJudge NOI' },
  { value: 'openj_poj', label: 'OpenJudge POJ' },
  { value: 'kattis', label: 'Kattis' },
  { value: 'hihocoder', label: 'HihoCoder' },
  { value: 'hit', label: 'HIT' },
  { value: 'hrbust', label: 'HRBUST' },
  { value: 'eijudge', label: 'EIJudge' },
  { value: 'atcoder', label: 'AtCoder' },
  { value: 'hackerrank', label: 'HackerRank' },
  { value: '51nod', label: '51Nod' },
  { value: 'topcoder', label: 'TopCoder' },
  { value: 'eolymp', label: 'EOlymp' },
  { value: 'jisuanke', label: '计蒜客' },
  { value: 'libreoj', label: 'LibreOJ' },
  { value: 'uoj', label: 'UOJ' },
  { value: 'darkbzoj', label: '黑暗爆炸' },
  { value: 'csgdmoj', label: 'CSGDMOJ' },
  { value: 'toph', label: 'Toph' },
  { value: 'luogu', label: '洛谷' },
  { value: 'baekjoon', label: 'Baekjoon' },
  { value: 'qoj', label: 'QOJ' },
  { value: 'cses', label: 'CSES' },
  { value: 'usaco', label: 'USACO' },
  { value: 'oj.uz', label: 'oj.uz' },
  { value: 'yosupo', label: 'Yosupo' },
  { value: 'yukicoder', label: 'yukicoder' },
  { value: 'vnoj', label: 'VNOJ' },
  { value: 'tlx', label: 'TLX' },
  { value: 'bzoj', label: 'BZOJ' },
  { value: 'kilonova', label: 'Kilonova' },
  { value: 'szkopul', label: 'Szkopuł' },
  { value: 'csacademy', label: 'CSAcademy' },
  { value: 'nowcoder', label: '牛客' },
  { value: 'krsu', label: 'KRSU' },
  { value: 'codefun', label: '代码源OJ' },
] as const

/**
 * OJ 平台标识符
 * @description 支持的 OJ 平台列表
 */
export type OjPlatform = 'luogu' | 'codeforces' | 'atcoder' | 'poj' | 'hdu' | 'spoj' | 'uva' | 'vijos' | 'bzoj' | 'gym' | 'qoj' | 'ural' | 'usaco' | 'tlx' | 'libreoj' | 'yosupo' | '51nod' | 'csacademy' | 'kattis' | 'yukicoder' | 'vnoj' | 'kilonova' | 'ojuz' | 'aizu' | 'openj_bailian' | 'openj_noi' | 'openj_poj' | 'uoj' | 'csg' | 'nowcoder' | 'szkopul' | 'darkbzoj' | 'dmoj' | 'cses' | 'baekjoon' | 'eolymp' | 'other'

/**
 * OJ 拉取错误码
 * @description 定义所有可能的错误类型
 */
export enum OjErrorCode {
  /** 无效的题号格式 */
  INVALID_PROBLEM_ID = 'INVALID_PROBLEM_ID',
  /** 题目不存在 */
  PROBLEM_NOT_FOUND = 'PROBLEM_NOT_FOUND',
  /** 网络请求失败 */
  NETWORK_ERROR = 'NETWORK_ERROR',
  /** 客户端错误（4xx） */
  CLIENT_ERROR = 'CLIENT_ERROR',
  /** 服务端错误（5xx） */
  SERVER_ERROR = 'SERVER_ERROR',
  /** 解析失败 */
  PARSE_ERROR = 'PARSE_ERROR',
  /** 限流触发 */
  RATE_LIMITED = 'RATE_LIMITED',
  /** 平台不支持 */
  PLATFORM_NOT_SUPPORTED = 'PLATFORM_NOT_SUPPORTED',
}

/**
 * OJ 拉取错误
 * @description 封装 OJ 拉取过程中的所有错误
 */
export class OjFetchError extends Error {
  constructor(
    public code: OjErrorCode,
    message: string,
    public cause?: Error
  ) {
    super(message)
    this.name = 'OjFetchError'
  }
}

/**
 * OJ 附件信息
 * @description 从外部 OJ 平台获取的附件信息
 */
export interface OjAttachment {
  /** 文件名 */
  filename: string
  /** 下载链接 */
  downloadLink: string
}

/**
 * OJ 题面/题解版本
 * @description 从 OJ 平台拉取的多语言题面/题解
 */
export interface OjStatement {
  /** 类型：题面或题解 */
  type: 'statement' | 'solution'
  /** 格式：markdown 或 pdf */
  format: 'markdown' | 'pdf'
  /** 语言：zh, en 或 null（PDF 无语言） */
  language?: 'zh' | 'en' | null
  /** Markdown 内容 */
  content?: string
  /** PDF 文件 URL */
  fileUrl?: string
  /** 是否可见 */
  isVisible: boolean
}

/**
 * OJ 题目数据结构
 * @description 从外部 OJ 平台拉取的标准化题目信息
 */
export interface OjProblem {
  /** 题目标题 */
  title: string
  /** 题目描述（Markdown 格式）- 单语言时使用 */
  description: string
  /** 时间限制（毫秒） */
  timeLimit?: number
  /** 内存限制（MB） */
  memoryLimit?: number
  /** 难度等级 */
  difficulty?: string
  /** 题目来源信息 */
  source: {
    /** OJ 平台标识 */
    platform: OjPlatform
    /** 原题号 */
    problemId: string
    /** 原题链接 */
    url: string
  }
  /** 附件列表 */
  attachments?: OjAttachment[]
  /** 多语言题面/题解版本（可选，用于支持多语言） */
  statements?: OjStatement[]
}

/**
 * OJ 适配器接口
 * @description 所有 OJ 平台适配器必须实现此接口
 */
export interface OjAdapter {
  /** 平台显示名称（中文） */
  name: string
  /** 平台标识符 */
  platform: OjPlatform
  /**
   * 从平台拉取题目信息
   * @param problemId - 题目 ID
   * @returns 标准化的题目信息
   * @throws {OjFetchError} 当题目不存在、网络错误或其他错误时抛出
   */
  fetch(problemId: string): Promise<OjProblem>
  /**
   * 验证题号格式是否正确
   * @param problemId - 待验证的题号
   * @returns 格式是否正确
   */
  isValidProblemId(problemId: string): boolean
  /**
   * 获取题目在原平台的 URL
   * @param problemId - 题目 ID
   * @returns 完整的题目链接
   */
  getProblemUrl(problemId: string): string
  /**
   * 限流配置（可选）
   * @description 定义该平台的请求频率限制
   */
  rateLimitConfig?: {
    /** 每秒最大请求数 */
    requestsPerSecond: number
    /** 随机抖动范围（秒）[min, max] */
    jitterRange?: [number, number]
    /** 最大重试次数 */
    maxRetries?: number
  }
}

/**
 * HTTP 状态码映射
 * @description 将 OjErrorCode 映射到 HTTP 状态码
 */
export const OJ_ERROR_HTTP_STATUS: Record<OjErrorCode, number> = {
  [OjErrorCode.INVALID_PROBLEM_ID]: 400,
  [OjErrorCode.PROBLEM_NOT_FOUND]: 404,
  [OjErrorCode.NETWORK_ERROR]: 503,
  [OjErrorCode.CLIENT_ERROR]: 502,
  [OjErrorCode.SERVER_ERROR]: 502,
  [OjErrorCode.PARSE_ERROR]: 500,
  [OjErrorCode.RATE_LIMITED]: 429,
  [OjErrorCode.PLATFORM_NOT_SUPPORTED]: 400,
}