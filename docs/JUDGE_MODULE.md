# 评测机模块文档

> 最后更新: 2026-04-23

本文档详细描述 OI Manager 评测机模块的架构、工作流程、配置和 API。

---

## 1. 概述

### 1.1 模块定位

评测机模块是一个独立的服务，负责：
- 接收后端下发的评测任务
- 在沙箱环境中编译和执行用户代码
- 对比输出结果，计算评测分数
- 返回评测结果给后端

### 1.2 核心特性

- **沙箱隔离**：使用 go-judge 提供进程级隔离和资源限制
- **多语言支持**：C/C++ (c11/cpp11/cpp14/cpp17/cpp20)
- **多种题型**：默认题、交互题、通信题、提交答案题
- **子任务支持**：支持 min/max/sum 三种子任务类型
- **自定义 Checker**：支持 testlib/lemon/hustoj 等多种校验器格式

### 1.3 技术栈

| 组件 | 技术 |
|------|------|
| 运行环境 | Node.js >= 18 |
| 沙箱引擎 | go-judge (https://github.com/criyle/go-judge) |
| 通信协议 | WebSocket |
| 配置格式 | YAML + TypeScript |

---

## 2. 架构设计

### 2.1 系统架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      Backend Server                          │
│  (apps/server)                                               │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ API Routes  │───▶│ WS Handler  │◀───│ Submission  │      │
│  │             │    │ /ws/judge   │    │ Table       │      │
│  └─────────────┘    └──────┬──────┘    └─────────────┘      │
│                            │                                 │
└────────────────────────────┼─────────────────────────────────┘
                             │ WebSocket
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                     Judge Service                            │
│  (apps/judge)                                                │
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │ WS Client   │───▶│ Judge Core  │───▶│ Checker     │      │
│  │ (client.ts) │    │ (judge.ts)  │    │ (checker/)  │      │
│  └─────────────┘    └──────┬──────┘    └─────────────┘      │
│                            │                                 │
│                            ▼                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Sandbox Layer                           │   │
│  │  ┌─────────────┐    ┌─────────────┐                 │   │
│  │  │ go-judge    │    │ Local Mode  │                 │   │
│  │  │ (端口 5050) │    │ (开发测试)  │                 │   │
│  │  └─────────────┘    └─────────────┘                 │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 目录结构

```
apps/judge/
├── src/
│   ├── index.ts           # 服务入口
│   ├── config.ts          # 配置管理
│   ├── client.ts          # WebSocket 客户端（连接后端）
│   ├── judge.ts           # 评测核心逻辑
│   ├── types.ts           # 类型定义
│   ├── langs.ts           # 语言配置
│   ├── test.ts            # 测试用例
│   │
│   ├── sandbox/
│   │   ├── client.ts      # go-judge 沙箱客户端
│   │   └── local.ts       # 本地执行器（无沙箱）
│   │
│   └── checker/
│   │   └── index.ts       # 输出校验器实现
│   │
│   └── langs.yaml         # 语言配置（备用）
│   │
│   └── testdata/          # 测试数据目录（动态加载）
│       ├── problem_1005/
│       │   ├── 1.in
│       │   ├── 1.out
│       │   └── config.yaml
│       └── ...
│
├── .env                   # 环境变量配置
├── package.json
└── tsconfig.json
```

---

## 3. 核心组件详解

### 3.1 服务入口 (index.ts)

评测机服务的启动入口，负责：
1. 加载配置
2. 检查沙箱服务可用性
3. 连接后端 WebSocket
4. 注册信号处理（优雅关闭）

```typescript
// 启动流程
async function start() {
  await checkSandbox()      // 检查 go-judge
  client.connect()          // 连接后端
  
  process.on('SIGINT', () => {
    client.disconnect()
    process.exit(0)
  })
}
```

### 3.2 配置管理 (config.ts)

**配置项说明**：

| 配置项 | 环境变量 | 默认值 | 说明 |
|--------|----------|--------|------|
| backendUrl | BACKEND_URL | ws://localhost:3002 | 后端 WebSocket 地址 |
| sandboxHost | SANDBOX_HOST | http://localhost:5050 | go-judge 沙箱地址 |
| judgeId | JUDGE_ID | judge-1 | 评测机唯一标识 |
| maxConcurrent | MAX_CONCURRENT | 2 | 最大并发评测数 |
| testdataDir | TESTDATA_DIR | ../server/testdata | 测试数据目录 |
| judgeTimeout | JUDGE_TIMEOUT | 60000 | 单次评测超时（ms） |
| logLevel | LOG_LEVEL | info | 日志级别 |

**配置加载顺序**：
1. 读取 `.env` 文件
2. 读取环境变量
3. 使用默认值兜底

### 3.3 WebSocket 客户端 (client.ts)

负责与后端的双向通信：

**消息类型**：

| 类型 | 方向 | 说明 |
|------|------|------|
| register | 评测机→后端 | 注册评测机身份 |
| registered | 后端→评测机 | 确认注册成功 |
| judge | 后端→评测机 | 下发评测任务 |
| result | 评测机→后端 | 返回评测结果 |
| ping | 后端→评测机 | 心跳检测 |
| pong | 评测机→后端 | 心跳响应 |

**连接流程**：
```
1. WebSocket 连接建立
2. 发送 register 消息（携带 judgeId 和支持的语言列表）
3. 等待 registered 确认
4. 进入消息循环：
   - 收到 judge 消息 → 执行评测 → 发送 result 消息
   - 收到 ping → 发送 pong
5. 连接断开 → 5 秒后自动重连
```

**自动重连机制**：
- 连接断开后等待 5 秒重连
- 心跳超时后主动断开重连
- 最大重连次数无限制（持续尝试）

### 3.4 评测核心 (judge.ts)

评测任务的执行流程：

**整体流程**：
```
1. 解析评测配置（时间/内存限制、Checker 类型）
2. 检查语言是否允许
3. 题目类型分发：
   - interactive → judgeInteractive()
   - communication → judgeCommunication()
   - submit_answer → judgeSubmitAnswer()
   - default/objective → 继续标准流程
4. 编译代码
5. 加载测试用例
6. 编译自定义 Checker（如果需要）
7. 执行测试点
8. 校验输出
9. 计算分数（子任务聚合）
10. 返回结果
```

**评测结果类型**：

| 结果 | 说明 |
|------|------|
| Accepted | 通过所有测试点 |
| Wrong Answer | 输出不匹配 |
| Time Limit Exceeded | 运行超时 |
| Memory Limit Exceeded | 内存超限 |
| Runtime Error | 运行时错误（崩溃、异常） |
| Compilation Error | 编译失败 |
| Presentation Error | 格式错误（暂不支持） |
| Output Limit Exceeded | 输出超限 |
| System Error | 系统错误（评测机内部） |
| Skipped | 跳过（依赖失败或提前终止） |

---

## 4. 沙箱层详解

### 4.1 go-judge 沙箱 (sandbox/client.ts)

go-judge 是一个基于 Linux namespace/cgroup 的沙箱引擎，提供：
- 进程隔离（独立的 namespace）
- 资源限制（CPU、内存、输出）
- 文件系统隔离
- 安全的网络隔离

**核心 API**：

#### compile() - 编译代码

```typescript
interface CompileParams {
  language: string      // 语言标识（cpp, cpp17 等）
  code: string          // 源代码
  timeLimit: number     // 编译时间限制（ms）
  memoryLimit: number   // 编译内存限制（KB）
  workDir?: string      // 本地模式工作目录
}

interface CompileResult {
  success: boolean
  error?: string
  fileId?: string       // go-judge 模式：编译产物 fileId
  workDir?: string      // 本地模式：工作目录路径
}
```

**编译流程**：
1. 根据 `language` 获取编译配置（编译命令、文件名）
2. 通过 go-judge 执行编译命令
3. 使用 `copyOutCached` 获取编译产物 fileId（go-judge 模式）
4. 或保存到本地目录（本地模式）

#### execute() - 执行程序

```typescript
interface ExecuteParams {
  language: string
  stdin?: string
  timeLimit: number     // ms
  memoryLimit: number   // KB
  outputLimit?: number  // bytes，默认 65536
  compileFileId?: string  // go-judge 模式的编译产物
  workDir?: string        // 本地模式的工作目录
  filename?: string       // File IO 模式文件名
  extraCopyIn?: Record<string, string>  // 额外文件
  addressSpaceLimit?: boolean  // RLIMIT_AS 限制
}

interface SandboxResult {
  status: JudgeResult
  time: number          // ms
  memory: number        // KB
  exitCode: number
  stdout?: string
  stderr?: string
}
```

**执行流程**：
1. 构建 `copyIn`（输入文件、编译产物）
2. 执行命令（stdin/stdout 或 File IO）
3. 解析结果（status、time、memory）
4. MLE/OLE 手动检测（go-judge 某些情况下不自动触发）

#### runCommand() - 执行单个命令

go-judge `/run` API 的封装：

```typescript
interface RunCommandParams {
  args: string[]        // 命令参数 ['sh', '-c', './main']
  env?: string[]        // 环境变量 ['PATH=/usr/bin']
  copyIn?: Record<string, { content: string } | { fileId: string }>
  copyOut?: string[]    // 需要取回的文件 ['stdout', 'stderr']
  copyOutCached?: string[]  // 需要缓存的文件（返回 fileId）
  cpuLimit?: number     // CPU 时间限制（ns）
  memoryLimit?: number  // 内存限制（bytes）
  strictMemoryLimit?: boolean  // cgroup 内存限制
  addressSpaceLimit?: boolean  // RLIMIT_AS 限制
  procLimit?: number    // 进程数限制
  outputLimit?: number  // 输出大小限制（bytes）
}
```

#### runPiped() - 管道执行

用于交互题和通信题，支持多进程管道连接：

```typescript
interface RunPipedParams {
  cmds: Array<{
    args: string[]
    copyIn?: Record<string, { content: string } | { fileId: string }>
    cpuLimit?: number
    memoryLimit?: number
    ...
  }>
  pipeMapping?: Array<{
    in: { index: number; fd: number }   // 输入端
    out: { index: number; fd: number }  // 输出端
  }>
}
```

**管道映射示例**：
```typescript
// 交互题：interactor 输出 → user program 输入
pipeMapping: [
  { in: { index: 0, fd: 0 }, out: { index: 1, fd: 1 } }  // interactor stdout → user stdin
]
```

### 4.2 本地执行器 (sandbox/local.ts)

当 go-judge 不可用时，使用本地直接执行。**警告：无进程隔离，仅用于开发测试！**

**核心函数**：

- `localCompile()` - 本地编译
- `localExecute()` - 本地执行
- `runPipedLocal()` - 本地管道执行

**与 go-judge 的区别**：

| 特性 | go-judge | 本地模式 |
|------|----------|----------|
| 进程隔离 | ✅ namespace | ❌ |
| 内存限制 | ✅ cgroup | ❌ |
| 时间限制 | ✅ 精确 | ⚠️ Node.js timeout |
| 安全性 | ✅ 生产可用 | ❌ 仅开发测试 |

### 4.3 MLE 检测增强

go-judge 在某些情况下不自动触发 MLE（如 `new` 失败）。已添加 stderr-based 检测：

```typescript
// sandbox/client.ts 第 300-312 行
const isMemoryAllocationError = (stderr && (
  stderr.includes('bad_alloc') ||
  stderr.includes('std::bad_alloc') ||
  stderr.includes('memory allocation failed') ||
  stderr.includes('Cannot allocate memory') ||
  stderr.includes('Out of memory')
)) || false

// 在 Nonzero Exit Status 处理中：
if (memory >= memoryLimit * 0.9 || isMemoryAllocationError) {
  status = 'Memory Limit Exceeded'
  memory = memoryLimit
}
```

---

## 5. Checker 校验器详解

### 5.1 Checker 类型

| 类型 | 说明 | 实现方式 |
|------|------|----------|
| default | 默认校验器，忽略行末空格和末尾空行 | JS 实现 |
| strict | 严格校验，完全匹配 | JS 实现 |
| testlib | testlib 格式，支持自定义逻辑 | 沙箱执行 |
| lemon | Lemon OJ 格式 | 沙箱执行 |
| hustoj | HUSTOJ 格式 | 沙箱执行 |
| qduoj | QDUOJ 格式 | 沙箱执行 |
| syzoj | SYZOJ 格式 | 沙箱执行 |
| kattis | Kattis 格式 | 沙箱执行 |

### 5.2 default Checker 实现

```typescript
function defaultChecker(userOutput: string, expectedOutput: string): CheckerResult {
  // 1. 统一换行符（\r\n → \n）
  // 2. 移除行末空格（trimEnd）
  // 3. 移除末尾空行（trimEnd）
  // 4. 逐行对比
}
```

### 5.3 自定义 Checker 配置

**配置格式**（config.yaml）：

```yaml
checker_type: testlib
checker:
  file: checker.cpp
  lang: cpp17
```

或直接在 ProblemConfig 中：

```typescript
{
  checker_type: 'testlib',
  checker: {
    file: 'checker.cpp',
    lang: 'cpp17',
    // 或直接传源码：
    // code: '#include "testlib.h"...',
    // language: 'cpp17'
  }
}
```

### 5.4 testlib Checker 流程

1. 从 testdata 目录读取 checker 源码
2. 在沙箱中编译 checker
3. 执行 checker，传入：
   - `input` - 输入文件内容
   - `output` - 用户输出
   - `answer` - 期望答案
4. 解析 checker 输出（格式：`ok` 或 `wa XXX` 或 `points X`）

---

## 6. 语言配置

### 6.1 支持的语言

| 语言标识 | 编译器/版本 | 编译命令 |
|---------|------------|----------|
| c | GCC | `gcc main.c -o main -O2 -Wall` |
| c11 | GCC C11 | `gcc main.c -o main -O2 -std=c11 -Wall` |
| cpp | GCC C++17 | `g++ main.cpp -o main -O2 -std=c++17 -Wall` |
| cpp11 | GCC C++11 | `g++ main.cpp -o main -O2 -std=c++11 -Wall` |
| cpp14 | GCC C++14 | `g++ main.cpp -o main -O2 -std=c++14 -Wall` |
| cpp17 | GCC C++17 | `g++ main.cpp -o main -O2 -std=c++17 -Wall` |
| cpp20 | GCC C++20 | `g++ main.cpp -o main -O2 -std=c++20 -Wall` |

### 6.2 语言配置结构

```typescript
interface LanguageConfig {
  code_file: string       // 源代码文件名（如 'main.cpp'）
  execute_file?: string   // 可执行文件名（如 'main'）
  compile?: string        // 编译命令
  execute: string         // 执行命令（如 './main'）
  compile_time_limit?: number   // 编译时间限制（ms），默认 10000
  compile_memory_limit?: number // 编译内存限制（KB），默认 524288
}
```

---

## 7. 测试数据格式

### 7.1 目录结构

```
testdata/
├── problem_1005/
│   ├── config.yaml       # 评测配置
│   ├── 1.in              # 测试点 1 输入
│   ├── 1.out             # 测试点 1 答案
│   ├── 2.in
│   ├── 2.out
│   └── checker.cpp       # 自定义 checker（可选）
│
├── problem_1006/
│   ├── config.yaml
│   └── ...
```

### 7.2 config.yaml 格式

**基础格式**：

```yaml
type: default
time: 1s
memory: 256MB
filename: data          # File IO 模式（可选）
checker_type: default
ignore_trailing_space: true

cases:
  - input: 1.in
    output: 1.out
    time: 1s
    memory: 256MB
  - input: 2.in
    output: 2.out
```

**子任务格式**：

```yaml
type: default
time: 1s
memory: 256MB

subtasks:
  - id: 1
    type: min            # min: 全部通过才得分
    score: 30
    cases:
      - input: 1.in
        output: 1.out
      - input: 2.in
        output: 2.out
  
  - id: 2
    type: max            # max: 最高分用例得分
    score: 20
    if: [1]              # 依赖子任务 1
    cases:
      - input: 3.in
        output: 3.out
  
  - id: 3
    type: sum            # sum: 累加各用例分数
    score: 50
    cases:
      - input: 4.in
        output: 4.out
        score: 10
      - input: 5.in
        output: 5.out
        score: 20
```

**交互题格式**：

```yaml
type: interactive
time: 1s
memory: 256MB

interactor:
  file: interactor.cpp
  lang: cpp17

cases:
  - input: 1.in
    output: 1.out
```

---

## 8. 题目类型详解

### 8.1 default（默认题型）

标准评测流程：
1. 编译用户代码
2. 对每个测试点：
   - 执行用户程序（传入 stdin）
   - 获取 stdout
   - 使用 Checker 校验输出
3. 计算总分

### 8.2 interactive（交互题）

用户程序与 interactor 进行双向交互：

**流程**：
1. 编译用户代码
2. 编译 interactor
3. 使用 `runPiped` 同时启动两个进程
4. interactor stdout → user stdin
5. user stdout → interactor stdin
6. interactor 退出后返回结果

**配置示例**：

```yaml
type: interactive
interactor:
  file: interactor.cpp
  lang: cpp17
```

### 8.3 communication（通信题）

多个用户程序之间通过管道通信：

**流程**：
1. 编译多个用户程序
2. 使用 `runPiped` 启动所有进程
3. 按配置连接管道
4. 等待所有进程结束
5. 计算分数

**配置示例**：

```yaml
type: communication
num_processes: 2
cases:
  - input: 1.in
    output: 1.out
```

### 8.4 submit_answer（提交答案题）

用户直接提交答案文件，不需要执行代码：

**流程**：
1. 直接读取用户提交的答案
2. 使用 Checker 校验
3. 计算分数

---

## 9. 子任务评分机制

### 9.1 子任务类型

| 类型 | 说明 | 评分逻辑 |
|------|------|----------|
| min | 最小值型 | 所有测试点通过才得分，否则 0 分 |
| max | 最大值型 | 取各测试点的最高分 |
| sum | 求和型 | 累加各测试点分数 |

### 9.2 子任务依赖

通过 `if` 字段声明依赖：

```yaml
subtasks:
  - id: 1
    type: min
    score: 30
    cases: [...]
  
  - id: 2
    type: min
    score: 70
    if: [1]            # 依赖子任务 1
    cases: [...]
```

**依赖检查逻辑**：
- 如果依赖的子任务失败，当前子任务所有测试点标记为 `Skipped`
- 提前终止优化：min 类型遇到失败用例后跳过剩余用例

### 9.3 分数分配

**未指定 case 级分数时**：
- min/max 类型：继承子任务分数
- sum 类型：均匀分配分数给各 case

---

## 10. 部署与运维

### 10.1 环境要求

| 组件 | 要求 |
|------|------|
| Node.js | >= 18.0 |
| go-judge | >= 1.0（推荐最新版） |
| GCC | >= 9.0（支持 C++17/20） |
| Linux | kernel >= 4.6（支持 cgroup v2） |

### 10.2 go-judge 安装

```bash
# 下载
wget https://github.com/criyle/go-judge/releases/download/v1.8.0/go-judge-linux-amd64

# 启动
./go-judge-linux-amd64 -port 5050

# 验证
curl http://localhost:5050/version
```

### 10.3 评测机启动

```bash
cd apps/judge

# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 设置 BACKEND_URL、SANDBOX_HOST 等

# 启动
npm run dev    # 开发模式
npm run build && npm start  # 生产模式
```

### 10.4 常用命令

```bash
# 检查沙箱状态
curl http://localhost:5050/version

# 检查评测机连接
curl http://localhost:3002/api/judge/status

# 查看评测机日志
pm2 logs judge  # 如果用 PM2 部署
```

---

## 11. 故障排查

### 11.1 沙箱不可用

**症状**：日志显示 `Sandbox service is not available`

**排查**：
1. 检查 go-judge 是否启动：`curl http://localhost:5050/version`
2. 检查端口是否监听：`ss -tlnp | grep 5050`
3. 检查防火墙规则

**解决**：启动 go-judge 或使用本地模式（仅开发测试）

### 11.2 编译失败

**症状**：返回 Compilation Error

**排查**：
1. 检查 GCC 是否安装：`g++ --version`
2. 检查源代码语法
3. 查看 stderr 详细错误信息

### 11.3 MLE 不触发

**症状**：MLE 代码返回 Runtime Error

**原因**：内存分配在 `new` 时失败，实际未分配大内存

**解决**：已通过 stderr-based 检测修复（见 4.3）

### 11.4 WebSocket 断连

**症状**：评测机频繁重连

**排查**：
1. 检查后端 WebSocket 服务状态
2. 检查网络连接
3. 查看后端日志是否有错误

---

## 12. API 参考

### 12.1 WebSocket 消息格式

**注册消息**：
```json
{
  "type": "register",
  "payload": {
    "judgeId": "judge-1",
    "languages": ["c", "cpp", "cpp17", "cpp20"]
  }
}
```

**评测任务消息**：
```json
{
  "type": "judge",
  "payload": {
    "submissionId": "123",
    "problemId": "1005",
    "code": "#include...",
    "language": "cpp17",
    "config": {
      "type": "default",
      "time": "1s",
      "memory": "256MB"
    },
    "testdataPath": "/path/to/testdata/problem_1005"
  }
}
```

**结果消息**：
```json
{
  "type": "result",
  "payload": {
    "submissionId": "123",
    "result": "Accepted",
    "time": 100,
    "memory": 1024,
    "score": 100,
    "cases": [
      { "caseId": 0, "result": "Accepted", "time": 50, "memory": 512 },
      { "caseId": 1, "result": "Accepted", "time": 50, "memory": 512 }
    ],
    "subtasks": [
      { "id": 1, "type": "min", "score": 100, "cases": [...] }
    ]
  }
}
```

### 12.2 go-judge HTTP API

**执行命令**：
```
POST /run
Content-Type: application/json

{
  "cmd": [
    {
      "args": ["sh", "-c", "./main"],
      "env": ["PATH=/usr/bin"],
      "files": [{ "fd": 0 }, { "fd": 1 }, { "fd": 2 }],
      "cpuLimit": 1000000000,
      "memoryLimit": 268435456,
      "procLimit": 50,
      "copyIn": {
        "main": { "fileId": "xxx" },
        "stdin": { "content": "1 2" }
      },
      "copyOut": ["stdout", "stderr"],
      "copyOutOptional": ["stdout", "stderr"]
    }
  ]
}
```

**响应**：
```json
[
  {
    "status": "Accepted",
    "exitStatus": 0,
    "time": 1000000,
    "memory": 1024000,
    "runTime": 1500000,
    "files": {
      "stdout": "3\n",
      "stderr": ""
    }
  }
]
```

---

## 13. 更新日志

### 2026-04-23
- 创建评测机模块详细文档
- 记录架构设计、核心组件、API 参考

### 2026-04-23 (MLE 检测增强)
- 添加 stderr-based 内存分配错误检测
- 修复 MLE 返回 Runtime Error 问题

### 2026-04-21
- 支持交互题、通信题、提交答案题
- 添加子任务依赖和提前终止优化

### 2026-04-11
- 添加自定义 Checker 支持（testlib 等）

### 2026-04-10
- 初始版本：支持 default 题型、基础评测流程