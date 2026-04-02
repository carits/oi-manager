# VJudge 团队导入功能实现计划

## 背景

实现从 VJudge 平台导入团队的功能，支持：
1. 通过 Cookie 鉴权获取用户管理的 VJudge 团队列表
2. 下拉选择团队（显示格式：团队名(short_name)）
3. 选择拉取内容（公告、描述、成员）
4. 如果选择拉取成员，需要：
   - 展示成员列表
   - 支持删除成员
   - 设置入学年份（enrollmentYear）
   - 支持批量设置入学年份
   - 可修改用户名和昵称

## 技术方案

### 1. 后端实现

#### 1.1 扩展 VJudge Session（vjudge-session.ts）

添加数据提取方法：

```typescript
// 在 VJudgeSession 类中添加

/**
 * 从 HTML 中提取 dataJson
 */
private extractDataJson(html: string): any {
  const m = html.match(
    r'<textarea[^>]*name=["\']dataJson["\'][^>]*>(.*?)</textarea>',
    html,
    re.S
  )
  if (!m) return null
  const raw = html.unescape(m.group(1).strip())
  return JSON.parse(raw)
}

/**
 * 获取用户管理的团队列表
 */
async getMyGroups(): Promise<VjudgeGroupItem[]>

/**
 * 获取团队详情
 */
async getGroupDetails(shortName: string): Promise<VjudgeGroupDetails>
```

#### 1.2 新增 VJudge 导入服务

**新建文件**: `apps/server/src/modules/team-import/vjudge-import.service.ts`

```typescript
export class VjudgeImportService {
  /**
   * 获取用户的 VJudge 会话
   */
  private async getSession(userId: string): Promise<VJudgeSession | null>

  /**
   * 获取团队列表
   */
  async getGroups(userId: string): Promise<VjudgeGroupItem[]>

  /**
   * 预览团队成员
   */
  async previewGroup(
    userId: string,
    shortName: string,
    options: { includeAnnouncement: boolean; includeDescription: boolean; includeMembers: boolean }
  ): Promise<VjudgeGroupPreview>

  /**
   * 执行导入
   */
  async importMembers(
    userId: string,
    schoolId: string,
    teamId: string,
    members: VjudgeMemberInput[]
  ): Promise<ImportResult>
}
```

#### 1.3 新增 API 路由

**修改文件**: `apps/server/src/modules/team-import/team-import.routes.ts`

```typescript
// 新增端点
router.get('/vjudge/groups', authenticate, async (req, res) => {
  // 获取 VJudge 团队列表
})

router.post('/vjudge/preview', authenticate, async (req, res) => {
  // 预览团队内容（公告、描述、成员）
})

router.post('/vjudge/import', authenticate, async (req, res) => {
  // 确认导入成员
})
```

#### 1.4 数据结构

```typescript
// VJudge 团队列表项
interface VjudgeGroupItem {
  groupId: string      // short_name
  groupName: string    // 团队名
}

// VJudge 团队预览
interface VjudgeGroupPreview {
  groupId: string
  groupName: string
  groupDescription?: string
  announcement?: string
  members?: VjudgeMember[]
}

// VJudge 成员（可编辑）
interface VjudgeMember {
  username: string
  nickname: string
  enrollmentYear?: number  // 用户设置
  selected?: boolean       // 是否选中导入
}

// 导入请求
interface VjudgeImportRequest {
  teamId: string
  members: VjudgeMemberInput[]
  createTeam?: boolean
  teamName?: string
}

interface VjudgeMemberInput {
  username: string
  nickname: string
  studentName?: string  // 用户指定的学生姓名
  enrollmentYear: number
}
```

### 2. 前端实现

#### 2.1 新建 VJudge 导入页面

**新建文件**: `apps/web/src/app/teacher/team-import/vjudge/page.tsx`

**页面流程**：

```
Step 1: 选择团队
┌─────────────────────────────────────────────┐
│  VJudge 团队导入                             │
│                                             │
│  选择团队: [下拉列表: 团队名(short_name) ▼]   │
│                                             │
│  [取消]                          [下一步]    │
└─────────────────────────────────────────────┘

Step 2: 选择拉取选项
┌─────────────────────────────────────────────┐
│  选择要拉取的内容                            │
│                                             │
│  [x] 团队公告                                │
│  [x] 团队描述                                │
│  [x] 团队成员                                │
│                                             │
│  [上一步]                        [预览]      │
└─────────────────────────────────────────────┘

Step 3: 预览成员（如果选择了拉取成员）
┌─────────────────────────────────────────────┐
│  成员列表 (共 N 人)                          │
│                                             │
│  批量设置入学年份: [2024 ▼] [应用到全部新成员]│
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ [x] 用户名: zhangsan          [新成员] │  │
│  │     昵称: 张三                        │  │
│  │     入学年份: [2024 ▼]                │  │
│  │     学生姓名: [张三____] [删除]        │  │
│  └───────────────────────────────────────┘  │
│  ┌───────────────────────────────────────┐  │
│  │ [x] 用户名: lisi      [已存在-发送邀请] │  │
│  │     昵称: 李四 (不可更改)              │  │
│  │     已匹配学生: 李四 (三年二班)        │  │
│  │     [删除]                             │  │
│  └───────────────────────────────────────┘  │
│  ...                                        │
│                                             │
│  [上一步]                        [确认导入] │
└─────────────────────────────────────────────┘

说明：
- [新成员]: 系统中不存在，需要创建学生，可编辑入学年份和学生姓名
- [已存在-发送邀请]: 系统中已匹配到学生，信息不可更改，将发送团队邀请

Step 4: 导入结果
┌─────────────────────────────────────────────┐
│  导入完成                                    │
│                                             │
│  成功: N 人                                  │
│  失败: 0 人                                  │
│                                             │
│  [返回团队列表]                              │
└─────────────────────────────────────────────┘
```

#### 2.2 复用现有逻辑

- 复用 `team-import.service.ts` 中的学生创建逻辑
- 复用 `teamService.addMembersDirectly()` 添加团队成员
- 复用 `bcryptjs` 密码哈希

### 3. 与现有模块集成

#### 3.1 获取 VJudge 会话

```typescript
// 从用户平台绑定中获取 Cookie
const binding = await prisma.userPlatformBinding.findUnique({
  where: { userId_platform: { userId, platform: 'vjudge' } }
})

if (!binding?.bindingData) {
  throw new Error('请先绑定 VJudge 账号')
}

const sessionData = JSON.parse(binding.bindingData)
const session = new VJudgeSession(sessionData.cookies)
```

#### 3.2 学生创建逻辑

复用 `students.ts` 中的创建逻辑：
```typescript
// 创建 User + Student
const tempUsername = `stu_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`
const tempPassword = Math.random().toString(36).substring(2, 10)
const passwordHash = await bcrypt.hash(tempPassword, 10)

await prisma.$transaction(async (tx) => {
  const newUser = await tx.user.create({
    data: { id: uuidv4(), username: tempUsername, passwordHash, role: 'student' }
  })
  return tx.student.create({
    data: {
      id: uuidv4(),
      userId: newUser.id,
      name: studentName,
      schoolId,
      enrollmentYear,
      headTeacherId
    }
  })
})
```

## 实现步骤

### Phase 1: 后端 - VJudge 数据获取（估计 2 小时）

1. **vjudge-session.ts** - 添加 `getMyGroups()` 和 `getGroupDetails()` 方法
2. **vjudge-import.service.ts** - 创建导入服务
3. **team-import.routes.ts** - 添加 VJudge API 端点

### Phase 2: 前端 - 导入流程（估计 3 小时）

1. **创建页面** - `apps/web/src/app/teacher/team-import/vjudge/page.tsx`
2. **实现 Step 1** - 团队选择下拉框
3. **实现 Step 2** - 拉取选项选择
4. **实现 Step 3** - 成员列表展示和编辑
5. **实现 Step 4** - 导入结果展示

### Phase 3: 测试验证（估计 1 小时）

1. 使用测试 Cookie 验证团队列表获取
2. 验证成员预览和编辑功能
3. 验证学生创建和团队关联

## 文件修改清单

### 新建文件
| 文件路径 | 说明 |
|---------|------|
| `apps/server/src/modules/team-import/vjudge-import.service.ts` | VJudge 导入服务 |
| `apps/web/src/app/teacher/team-import/vjudge/page.tsx` | VJudge 导入页面 |

### 修改文件
| 文件路径 | 修改内容 |
|---------|----------|
| `apps/server/src/modules/platform-binding/binders/vjudge-session.ts` | 添加团队获取方法 |
| `apps/server/src/modules/team-import/team-import.routes.ts` | 添加 VJudge API 路由 |
| `apps/server/src/modules/team-import/team-import.types.ts` | 添加 VJudge 类型定义 |

### 可选修改
| 文件路径 | 修改内容 |
|---------|----------|
| `apps/web/src/components/AppShell.tsx` | 添加导航入口 |

## 验证方案

### 1. 后端 API 测试

```bash
# 获取团队列表
curl -H "Authorization: Bearer <token>" \
  http://localhost:3001/api/team-import/vjudge/groups

# 预览团队
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"shortName": "wildwolf_2027", "includeMembers": true}' \
  http://localhost:3001/api/team-import/vjudge/preview

# 执行导入
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"teamId": "xxx", "members": [...]}' \
  http://localhost:3001/api/team-import/vjudge/import
```

### 2. 前端功能测试

1. 使用已绑定 VJudge 的教师账号登录
2. 进入团队导入页面
3. 选择 VJudge 团队
4. 预览并编辑成员
5. 确认导入
6. 验证学生创建成功
7. 验证团队成员关联正确

## 风险与注意事项

1. **VJudge Cloudflare 拦截**: 部分请求可能被 Cloudflare 拦截，需要处理验证码场景
2. **Cookie 有效期**: VJudge Cookie 可能过期，需要提示用户重新绑定
3. **成员数量限制**: 大量成员导入可能需要分批处理
4. **用户名冲突**: 系统自动生成的用户名可能冲突，需要去重机制

## 成员匹配逻辑

### 匹配规则

1. **按 VJudge 用户名匹配**: 检查学生是否已绑定该 VJudge 账号
2. **按姓名匹配**: 如果昵称与学生姓名相同，视为可能匹配

### 匹配状态

| 状态 | 说明 | 操作 |
|------|------|------|
| 新成员 | 系统中无匹配学生 | 创建新学生 + 加入团队 |
| 已存在 | 系统中有匹配学生 | 发送团队邀请，信息不可更改 |

### 匹配结果处理

```typescript
interface VjudgeMemberWithStatus extends VjudgeMember {
  status: 'new' | 'existing'
  matchedStudentId?: string
  matchedStudentName?: string
  // 以下字段仅新成员可编辑
  enrollmentYear?: number  // 新成员必填
  studentName?: string     // 新成员可编辑
}
```

## 文档更新

完成后需更新以下文档：

| 文档 | 更新内容 |
|------|----------|
| `docs/current-task.md` | 记录任务完成状态 |
| `docs/change-log.md` | 记录变更内容 |
| `docs/api/API_REFERENCE.md` | 添加 VJudge 导入 API |
| `docs/MODULE_INDEX.md` | 添加 VJudge 导入模块索引 |
