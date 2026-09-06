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
  outputLimit?: string | number
  output_limit?: string | number
  score?: number
  groupId?: string
  groupKind?: 'official' | 'hack_gate'
  groupScore?: number
  groupType?: SubtaskType
}

export interface TestGroupConfig {
  id?: string
  name?: string
  kind: 'official' | 'hack_gate'
  score?: number
  type?: SubtaskType
  cases?: TestCaseConfig[]
}

export interface SubtaskConfig {
  id?: number
  time?: string
  memory?: string
  score?: number
  type?: SubtaskType
  if?: number[]
  cases?: TestCaseConfig[]
  groups?: TestGroupConfig[]
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
  outputLimit?: string | number // "64MB" or bytes
  output_limit?: string | number
  /** @deprecated Legacy submission IO prefix; new tasks carry JudgeRequest.io. */
  filename?: string
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
  judgeRunId?: string
  judgeAttemptId?: string
  fencingToken?: string
  dispatchedAt?: number
  problemId: string
  code: string
  language: string
  config: ProblemConfig
  ioAdapterVersion?: number
  io?: { inputFile: string | null; outputFile: string | null }
  testdataPath: string
  /** @deprecated Use config instead */
  problemConfig?: ProblemConfig
}

export interface JudgeCaseResult {
  caseId: number
  subtaskId?: number
  groupId?: string
  groupKind?: 'official' | 'hack_gate'
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
  /** Infrastructure failure: the task must be retried, never scored. */
  infrastructureError?: boolean
  outputFileMissing?: boolean
}

export interface SubtaskResult {
  id: number
  type: SubtaskType
  score: number
  cases: JudgeCaseResult[]
}

export interface JudgeTaskResult {
  submissionId: string
  judgeRunId?: string
  judgeAttemptId?: string
  fencingToken?: string
  phaseMetrics?: {
    dispatchMs?: number
    compileMs?: number
    runMs?: number
    judgeTotalMs?: number
  }
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
  /** Close the Judge connection so the server immediately requeues the task. */
  retryable?: boolean
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
  generatorProtocol?: 'oj.generator/v1' | 'legacy-empty-stdin-v1'
  hackSource: string
  hackLanguage: string
  inputFilename?: string | null
  outputFilename?: string | null
  standardSource: string
  standardLanguage?: 'cpp17'
  validatorSource: string
  validatorLanguage?: 'cpp17' | 'python3'
  classifierSource?: string
  classifierLanguage?: 'cpp17' | 'python3'
  hackMode?: 'acm' | 'oi'
  testGraphRevision?: number
}

export interface HackJudgeTaskResult {
  hackAttemptId: string
  outcome: 'accepted' | 'rejected' | 'system_error'
  failureStage?: 'input' | 'generator' | 'validator' | 'classifier' | 'standard' | 'checker' | 'baseline' | 'candidate'
  baselineResult?: JudgeResult
  baselineScore?: number
  candidateResult?: JudgeResult
  candidateScore?: number
  affectedSubtaskIds?: number[]
  message?: string
  inputData?: string
  outputData?: string
  inputSha256?: string
  outputSha256?: string
  /** Infrastructure failure: reconnect so the server requeues this Hack. */
  retryable?: boolean
}

export interface DataGenerationRequest {
  taskType: 'data_generation'
  jobId: string
  problemId: string
  fencingToken: string
  sourceMode: 'generator' | 'input'
  maxDataBytes?: number
  problemConfig: ProblemConfig
  generator?: { language: 'cpp17' | 'python3'; source: string; protocol?: 'legacy-args-v1' | 'json-stdin-v1' | 'oj.generator/v1' } | null
  standard: { language: 'cpp17'; source: string }
  validator: { language: 'cpp17' | 'python3'; source: string; protocol?: 'oj.validator/v1' }
  classifier?: { language: 'cpp17' | 'python3'; source: string; protocol?: 'oj.classifier/v1' } | null
  cases: Array<{ id: string; name: string; args: string[]; seed?: string | null; inputData?: string; profile?: string; params?: Record<string, unknown> }>
}

export interface DataGenerationResult {
  jobId: string
  fencingToken: string
  retryable?: boolean
  cases: Array<{ id: string; status: 'validated' | 'failed'; failureStage?: string; message?: string; inputData?: string; outputData?: string; generatorTimeMs?: number; validatorTimeMs?: number; standardTimeMs?: number; classificationStatus?: 'classified' | 'missing' | 'failed' | 'not_required'; classificationMessage?: string; affectedSubtaskIds?: number[] }>
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
  status: 'Accepted' | 'Time Limit Exceeded' | 'Memory Limit Exceeded' | 'Runtime Error' | 'Output Limit Exceeded' | 'Compilation Error' | 'System Error'
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
  /** Actual stdout when candidate output was read from a file. */
  capturedStdout?: string
  outputFileMissing?: boolean
  stderr?: string
  infrastructureError?: boolean
}

// ==================== WebSocket 消息 ====================

export interface WSMessage {
  type: 'register' | 'registered' | 'start' | 'started' | 'config' | 'judge' | 'result' | 'hack' | 'hack_result' | 'data_generation' | 'data_generation_result' | 'ping' | 'pong' | 'auth' | 'auth_success' | 'error'
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

export interface DataGenerationMessage { type: 'data_generation'; payload: DataGenerationRequest }
export interface DataGenerationResultMessage { type: 'data_generation_result'; payload: DataGenerationResult }
