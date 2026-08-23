/**
 * 评测系统类型定义
 * 兼容 Hydro OJ 的 ProblemConfigFile
 */

// ==================== 评测配置 ====================

export type ProblemType = 'default' | 'interactive' | 'objective' | 'submit_answer' | 'communication'
export type SubtaskType = 'min' | 'max' | 'sum'
export type MetricSource =
  | 'go-judge-cgroup'
  | 'local-unavailable'

export type TimeoutReason = 'cpu' | 'wall' | 'unknown' | null

export type JudgeResult =
  | 'Accepted'
  | 'Wrong Answer'
  | 'Time Limit Exceeded'
  | 'Memory Limit Exceeded'
  | 'Runtime Error'
  | 'Compilation Error'
  | 'Presentation Error'
  | 'Output Limit Exceeded'
  | 'System Error'
  | 'Skipped'          // 跳过的测试点（依赖失败或提前终止）
  | 'Judging'
  | 'Waiting'

export interface TestCaseConfig {
  input: string
  output: string
  time?: string      // "1s", "1000ms"
  memory?: string    // "256MB"
  score?: number
}

export interface SubtaskConfig {
  id?: number
  time?: string
  memory?: string
  score?: number
  type?: SubtaskType
  if?: number[]
  cases?: TestCaseConfig[]
}

export interface CompilableSource {
  language?: string
  lang?: string  // 前端传的简写形式，与 language 等价
  code?: string
  file?: string
}

export type JudgeMode = 'acm' | 'oi'

export interface ProblemConfig {
  mode?: JudgeMode
  type?: ProblemType
  time?: string          // "1s", "1000ms"
  memory?: string        // "256MB"
  filename?: string      // 文件 IO 题型的文件名
  checker_type?: string  // 'default' | 'strict' | 'testlib' | 'lemon' | ...
  checker?: CompilableSource
  interactor?: CompilableSource
  manager?: CompilableSource
  subtasks?: SubtaskConfig[]
  cases?: TestCaseConfig[]
  /** 允许的编程语言列表 */
  langs?: string[]
  /** 通信题进程数 */
  num_processes?: number
  /** 忽略行末空格（默认 true） */
  ignore_trailing_space?: boolean
  /** 用户提供给用户程序的额外文件（如辅助数据文件） */
  user_extra_files?: Record<string, string>
  /** 评测过程中可用但不对用户可见的额外文件 */
  judge_extra_files?: Record<string, string>
}

// ==================== 评测请求 ====================

export interface JudgeRequest {
  submissionId: string
  problemId: string
  code: string
  language: string
  config: ProblemConfig
  testdataPath: string
  /** @deprecated Use config instead */
  problemConfig?: ProblemConfig
}

export interface JudgeCaseResult {
  caseId: number
  subtaskId?: number
  result: JudgeResult
  /** Backward compatible CPU time, ms */
  time: number
  cpuTime?: number
  wallTime?: number
  memory?: number | null    // KiB; null means unavailable
  score?: number
  timeoutReason?: TimeoutReason
  metricSource?: MetricSource
  message?: string
}

export interface SubtaskResult {
  id: number
  type: SubtaskType
  score: number
  cases: JudgeCaseResult[]
}

export interface JudgeTaskResult {
  submissionId: string
  result: JudgeResult
  time: number
  cpuTime?: number
  wallTime?: number
  memory?: number | null
  score: number
  cases: JudgeCaseResult[]
  subtasks?: SubtaskResult[]
  timeoutReason?: TimeoutReason
  metricSource?: MetricSource
  message?: string
}

export interface HackJudgeRequest {
  taskType: 'hack'
  hackAttemptId: string
  problemId: string
  testdataPath: string
  config: ProblemConfig
  judgeConfigHash: string
  hackConfigRevision: number
  inputMode: 'data' | 'generator'
  inputData?: string
  generatorSource?: string
  generatorLanguage?: 'cpp17' | 'python3'
  hackSource: string
  hackLanguage: string
  standardSource: string
  validatorSource: string
}

export interface HackJudgeTaskResult {
  hackAttemptId: string
  outcome: 'accepted' | 'rejected' | 'system_error'
  failureStage?: 'input' | 'generator' | 'validator' | 'standard' | 'baseline' | 'candidate'
  baselineResult?: JudgeResult
  candidateResult?: JudgeResult
  message?: string
  inputData?: string
  outputData?: string
  inputSha256?: string
  outputSha256?: string
}

// ==================== 语言配置 ====================

export interface LanguageConfig {
  code_file: string       // 源代码文件名
  execute_file?: string   // 可执行文件名
  compile?: string        // 编译命令
  execute: string         // 执行命令
  compile_time_limit?: number   // 编译时间限制 (ms)
  compile_memory_limit?: number // 编译内存限制 (KB)
}

// ==================== 沙箱配置 ====================

export interface SandboxConfig {
  timeLimit: number       // ms
  memoryLimit: number     // KB
  outputLimit: number     // bytes
  processLimit: number
}

export interface SandboxResult {
  status: 'Accepted' | 'Time Limit Exceeded' | 'Memory Limit Exceeded' | 'Runtime Error' | 'Output Limit Exceeded' | 'Compilation Error'
  /** Backward compatible CPU time, ms */
  time: number
  cpuTime?: number
  wallTime?: number
  /** Peak memory in KiB; null means unavailable */
  memory?: number | null
  timeoutReason?: TimeoutReason
  metricSource?: MetricSource
  exitCode: number
  stdout?: string
  stderr?: string
}

// ==================== WebSocket 消息 ====================

export interface WSMessage {
  type: 'register' | 'registered' | 'start' | 'started' | 'config' | 'judge' | 'result' | 'hack' | 'hack_result' | 'ping' | 'pong' | 'auth' | 'auth_success' | 'error'
  payload: any
}

export interface RegisterMessage {
  type: 'register'
  payload: {
    judgeId: string
    languages: string[]
  }
}

export interface StartMessage {
  type: 'start'
  payload: {
    judgeId: string
    concurrency: number
  }
}

export interface ConfigMessage {
  type: 'config'
  payload: {
    concurrency: number
  }
}

export interface JudgeMessage {
  type: 'judge'
  payload: JudgeRequest
}

export interface ResultMessage {
  type: 'result'
  payload: JudgeTaskResult
}

export interface HackMessage {
  type: 'hack'
  payload: HackJudgeRequest
}

export interface HackResultMessage {
  type: 'hack_result'
  payload: HackJudgeTaskResult
}
