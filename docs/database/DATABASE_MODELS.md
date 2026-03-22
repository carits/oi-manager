# 数据库模型文档

## 数据库概述

- **数据库类型**: SQLite
- **ORM**: Prisma
- **Schema 文件**: `apps/server/prisma/schema.prisma`

## 核心模型

### 1. User (用户)

用户账号基础表，所有角色共用。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| username | String | ✅ | 用户名，唯一 |
| passwordHash | String | ✅ | 密码哈希（bcrypt） |
| role | String | ✅ | 角色：super_admin / platform_admin / school_principal / teacher / student |
| status | String | ✅ | 状态：active / disabled，默认 active |
| avatar | String | ❌ | 头像 URL |
| phone | String | ❌ | 手机号 |
| email | String | ❌ | 邮箱 |
| bio | String | ❌ | 个人简介 |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `student`: 一对一关联 Student
- `teacher`: 一对一关联 Teacher
- `contests`: 一对多关联 Contest（创建的比赛）

**索引**:
- `username`: 唯一索引

---

### 2. School (学校)

学校组织表，系统的顶层组织单位。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| name | String | ✅ | 学校名称 |
| announcement | String | ❌ | 学校公告（支持 Markdown） |
| region | String | ❌ | 所属区域（省/市/区，格式：省/市/区） |
| schoolType | String | ❌ | 学校类型：小学/初中/高中/小学+初中/初中+高中/小学+初中+高中 |
| educationSystem | String | ❌ | 学制：6-3-3（标准）或 5-4-3（特殊），默认 6-3-3 |
| contactPerson | String | ❌ | 联系人 |
| contactPhone | String | ❌ | 联系电话 |
| contactEmail | String | ❌ | 联系邮箱 |
| status | String | ✅ | 状态：active / disabled，默认 active |
| currentPrincipalTeacherId | String | ✅ | 当前负责人教师 ID（必填） |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `teams`: 一对多关联 Team
- `teachers`: 一对多关联 Teacher
- `students`: 一对多关联 Student
- `principalTransferLogs`: 一对多关联 PrincipalTransferLog

**业务规则**:
- 学校必须有唯一的负责人（currentPrincipalTeacherId）
- 学制支持 6-3-3（小学6年+初中3年+高中3年）和 5-4-3（小学5年+初中4年+高中3年）
- 区域格式：省/市/区，例如"湖南省/长沙市/岳麓区"

---

### 3. Teacher (教师)

教师信息表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| userId | String | ✅ | 关联 User.id，唯一 |
| name | String | ✅ | 姓名 |
| email | String | ❌ | 邮箱（与 phone 至少一个必填） |
| phone | String | ❌ | 手机号（与 email 至少一个必填） |
| avatar | String | ❌ | 头像 URL |
| bio | String | ❌ | 教学简介 |
| title | String | ❌ | 职称/身份 |
| status | String | ✅ | 状态：active / disabled，默认 active |
| schoolId | String | ❌ | 学校 ID |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `user`: 多对一关联 User
- `school`: 多对一关联 School
- `taskLists`: 一对多关联 TaskList
- `milestones`: 一对多关联 Milestone
- `students`: 一对多关联 Student（作为主教练）
- `ownedTeams`: 一对多关联 Team（作为团队所有者）
- `adminTeams`: 一对多关联 TeamAdmin（作为团队管理员）

**业务规则**:
- email 和 phone 至少必填一个（应用层验证）
- 教师可以担任多个团队的负责人
- 教师可以作为多个学生的主教练

**索引**:
- `userId`: 唯一索引

---

### 4. Student (学生)

学生信息表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| userId | String | ❌ | 关联 User.id，唯一（可选，学生可能没有账号） |
| name | String | ✅ | 姓名 |
| gender | String | ❌ | 性别 |
| schoolId | String | ✅ | 学校 ID（必填） |
| enrollmentYear | Int | ❌ | 入学年份（当前阶段入学年份） |
| targetContest | String | ❌ | 目标比赛 |
| headTeacherId | String | ❌ | 主教练 ID |
| tags | String | ❌ | 标签（JSON 字符串，如 ["图论", "DP"]） |
| notes | String | ❌ | 备注 |
| avatar | String | ❌ | 头像 URL |
| rating | Int | ✅ | Rating 值，默认 1200 |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `user`: 多对一关联 User
- `school`: 多对一关联 School
- `headTeacher`: 多对一关联 Teacher
- `teams`: 多对多关联 Team（通过 StudentTeam）
- `joinRequests`: 一对多关联 TeamJoinRequest
- `milestones`: 一对多关联 Milestone
- `taskProgresses`: 一对多关联 TaskProgress
- `contestResults`: 一对多关联 ContestResult
- `problemScores`: 一对多关联 ContestProblemScore

**业务规则**:
- 学生必须关联学校（schoolId 必填）
- 学生可以加入多个团队
- 学生的 rating 在校内唯一
- 年级根据 enrollmentYear、学校 schoolType 和 educationSystem 动态计算
- 入学阶段由学校类型自动推断：
  - 学校类型包含"小学" → 小学入学
  - 学校类型包含"初中"（不含小学） → 初中入学
  - 学校类型为"高中"（不含初中） → 高中入学

**索引**:
- `userId`: 唯一索引

---

### 5. Team (团队)

团队表，训练单元。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| name | String | ✅ | 团队名称 |
| avatar | String | ❌ | 团队头像 URL |
| description | String | ❌ | 团队描述 |
| announcement | String | ❌ | 团队公告（支持 Markdown） |
| schoolId | String | ✅ | 学校 ID（必填） |
| ownerId | String | ✅ | 团队所有者（教师 ID） |
| isPublic | Boolean | ✅ | 是否公开，默认 true |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `school`: 多对一关联 School
- `owner`: 多对一关联 Teacher（作为所有者）
- `admins`: 一对多关联 TeamAdmin
- `members`: 多对多关联 Student（通过 StudentTeam）
- `joinRequests`: 一对多关联 TeamJoinRequest
- `contests`: 一对多关联 Contest

**业务规则**:
- 团队必须归属学校
- 团队必须有所有者（教师）
- 公有团队可被学生浏览并申请加入
- 私有团队只能通过邀请加入

---

### 6. StudentTeam (学生-团队关系)

学生和团队的多对多关系表，包含邀请状态。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| studentId | String | ✅ | 学生 ID |
| teamId | String | ✅ | 团队 ID |
| status | String | ✅ | 状态：pending（待确认）/ active（已加入） |
| invitedAt | DateTime | ✅ | 邀请时间 |
| joinedAt | DateTime | ❌ | 加入时间（同意后填充） |
| invitedBy | String | ✅ | 邀请人（教师 ID） |

**关联关系**:
- `student`: 多对一关联 Student
- `team`: 多对一关联 Team

**索引**:
- `(studentId, teamId)`: 唯一索引

---

### 7. TeamAdmin (团队管理员)

团队管理员表，记录被任命的管理员教师。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| teamId | String | ✅ | 团队 ID |
| teacherId | String | ✅ | 教师 ID |
| status | String | ✅ | 状态：pending / active |
| addedAt | DateTime | ✅ | 添加时间 |
| addedBy | String | ✅ | 添加人（所有者教师 ID） |

**关联关系**:
- `team`: 多对一关联 Team
- `teacher`: 多对一关联 Teacher

**索引**:
- `(teamId, teacherId)`: 唯一索引

---

### 8. TeamJoinRequest (加入申请)

学生申请加入公有团队的请求记录。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| teamId | String | ✅ | 团队 ID |
| studentId | String | ✅ | 学生 ID |
| status | String | ✅ | 状态：pending / approved / rejected |
| message | String | ❌ | 申请留言 |
| createdAt | DateTime | ✅ | 申请时间 |
| processedAt | DateTime | ❌ | 处理时间 |
| processedBy | String | ❌ | 处理人（管理员教师 ID） |

**关联关系**:
- `team`: 多对一关联 Team
- `student`: 多对一关联 Student

**索引**:
- `(teamId, studentId)`: 唯一索引

---

### 9. Contest (比赛)

比赛表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| title | String | ✅ | 比赛标题 |
| description | String | ❌ | 比赛描述 |
| contestDate | DateTime | ✅ | 比赛日期 |
| status | String | ✅ | 状态：upcoming / ongoing / finished，默认 upcoming |
| type | String | ✅ | 类型：training / official / mock，默认 mock |
| teamId | String | ❌ | 团队 ID（训练赛/模拟赛必填） |
| countRating | Boolean | ✅ | 是否计入 rating，默认 false |
| scope | String | ✅ | 范围：team / public，默认 public |
| createdBy | String | ❌ | 创建者用户 ID |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `creator`: 多对一关联 User
- `team`: 多对一关联 Team
- `resources`: 一对多关联 ContestResource
- `results`: 一对多关联 ContestResult
- `problems`: 一对多关联 ContestProblem
- `problemScores`: 一对多关联 ContestProblemScore

**业务规则**:
- 训练赛和模拟赛必须关联团队（teamId 必填）
- 正赛可以不关联团队
- countRating 为 true 时，比赛结果会影响学生 rating

---

### 8. ContestResult (比赛结果)

比赛参赛结果表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| contestId | String | ✅ | 比赛 ID |
| studentId | String | ✅ | 学生 ID |
| rank | Int | ❌ | 名次 |
| score | Float | ❌ | 得分 |
| ratingBefore | Int | ✅ | 赛前 rating |
| ratingAfter | Int | ✅ | 赛后 rating |
| ratingChange | Int | ✅ | rating 变化值 |
| note | String | ❌ | 备注信息 |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `contest`: 多对一关联 Contest
- `student`: 多对一关联 Student

**索引**:
- `(contestId, studentId)`: 唯一索引

---

### 9. ContestProblem (比赛题目)

比赛题目表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| contestId | String | ✅ | 比赛 ID |
| orderIndex | Int | ✅ | 题目顺序 |
| title | String | ❌ | 自定义题目标题（isCustom 为 true 时使用） |
| description | String | ❌ | 自定义题目描述 |
| ojName | String | ❌ | OJ 名称（isCustom 为 false 时使用，如 LOJ/洛谷/CF） |
| problemId | String | ❌ | OJ 题号 |
| isCustom | Boolean | ✅ | 是否为自定义题目，默认 false |
| difficulty | String | ❌ | 难度：简单/中等/困难 |
| points | Int | ❌ | 分值 |
| statementType | String | ✅ | 题面类型：none / markdown / pdf，默认 none |
| statementMarkdown | String | ❌ | Markdown 题面内容 |
| solutionType | String | ✅ | 题解类型：none / markdown / pdf，默认 none |
| solutionMarkdown | String | ❌ | Markdown 题解内容 |
| solutionVisible | Boolean | ✅ | 题解是否对学生可见，默认 false |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `contest`: 多对一关联 Contest
- `resources`: 一对多关联 ContestResource
- `scores`: 一对多关联 ContestProblemScore

**索引**:
- `(contestId, orderIndex)`: 唯一索引

---

### 10. ContestProblemScore (比赛单题成绩)

比赛单题成绩表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| contestId | String | ✅ | 比赛 ID |
| problemId | String | ✅ | 题目 ID |
| studentId | String | ✅ | 学生 ID |
| score | Float | ❌ | 该题得分 |
| note | String | ❌ | 备注 |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `contest`: 多对一关联 Contest
- `problem`: 多对一关联 ContestProblem
- `student`: 多对一关联 Student

**索引**:
- `(contestId, problemId, studentId)`: 唯一索引

---

### 11. ContestResource (比赛资源)

比赛资源文件表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| contestId | String | ✅ | 比赛 ID |
| contestProblemId | String | ❌ | 关联到具体题目 |
| fileName | String | ✅ | 文件名 |
| fileType | String | ✅ | 文件类型：statement / ranklist / editorial / solution / slides |
| fileFormat | String | ✅ | 文件格式：pdf / markdown，默认 pdf |
| fileUrl | String | ✅ | 文件 URL |
| visibleRoles | String | ✅ | 可见角色：all / student / teacher，默认 all |
| uploadedBy | String | ✅ | 上传者 |
| uploadedAt | DateTime | ✅ | 上传时间 |

**关联关系**:
- `contest`: 多对一关联 Contest
- `problem`: 多对一关联 ContestProblem

---

### 12. TaskList (题单)

题单表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| title | String | ✅ | 题单标题 |
| description | String | ❌ | 题单描述 |
| publishAt | DateTime | ❌ | 发布时间 |
| deadline | DateTime | ❌ | 截止时间 |
| createdBy | String | ✅ | 创建者（教师 ID） |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `creator`: 多对一关联 Teacher
- `tasks`: 一对多关联 Task

---

### 13. Task (题目)

题单中的题目。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| taskListId | String | ✅ | 题单 ID |
| title | String | ✅ | 题目标题 |
| ojName | String | ❌ | OJ 名称（LOJ/洛谷/CF） |
| problemId | String | ❌ | 题号 |
| difficulty | String | ❌ | 难度：简单/中等/困难 |
| points | Int | ❌ | 分值 |
| notes | String | ❌ | 备注 |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `taskList`: 多对一关联 TaskList
- `progresses`: 一对多关联 TaskProgress

---

### 14. TaskProgress (题目进度)

学生题目完成进度表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| taskId | String | ✅ | 题目 ID |
| studentId | String | ✅ | 学生 ID |
| status | String | ✅ | 状态：pending / done / review，默认 pending |
| seenEditorial | Boolean | ✅ | 是否看了题解，默认 false |
| needHelp | Boolean | ✅ | 是否需要讲解，默认 false |
| notes | String | ❌ | 备注 |
| completedAt | DateTime | ❌ | 完成时间 |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `task`: 多对一关联 Task
- `student`: 多对一关联 Student

**索引**:
- `(taskId, studentId)`: 唯一索引

---

### 15. Milestone (里程碑)

学生成长里程碑表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| studentId | String | ✅ | 学生 ID |
| teacherId | String | ✅ | 教师 ID |
| title | String | ✅ | 里程碑标题 |
| description | String | ❌ | 描述 |
| milestoneDate | DateTime | ✅ | 里程碑日期 |
| type | String | ✅ | 类型：entry / upgrade / award / contest / goal |
| createdAt | DateTime | ✅ | 创建时间 |
| updatedAt | DateTime | ✅ | 更新时间 |

**关联关系**:
- `student`: 多对一关联 Student
- `teacher`: 多对一关联 Teacher

---

## 日志表

### 16. PrincipalTransferLog (负责人转移日志)

学校负责人转移日志表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| schoolId | String | ✅ | 学校 ID |
| oldPrincipalTeacherId | String | ❌ | 原负责人教师 ID（首任时为 null） |
| newPrincipalTeacherId | String | ✅ | 新负责人教师 ID |
| operatorUserId | String | ✅ | 操作人用户 ID |
| result | String | ✅ | 结果：success / failed |
| message | String | ❌ | 失败原因等备注 |
| createdAt | DateTime | ✅ | 创建时间 |

**关联关系**:
- `school`: 多对一关联 School

---

### 17. PasswordResetLog (密码重置日志)

密码重置日志表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| targetUserId | String | ✅ | 被重置密码的用户 |
| operatorUserId | String | ✅ | 操作人（super_admin 或 platform_admin） |
| operatorRole | String | ✅ | 操作人角色 |
| resetMethod | String | ✅ | 重置方式：temporary_password / manual_set |
| result | String | ✅ | 结果：success / failed |
| message | String | ❌ | 备注信息 |
| createdAt | DateTime | ✅ | 创建时间 |

---

### 18. UserStatusLog (用户状态变更日志)

用户状态变更日志表。

**字段说明**:
| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| id | String | ✅ | UUID 主键 |
| targetUserId | String | ✅ | 被操作的用户 |
| operatorUserId | String | ✅ | 操作人 |
| operatorRole | String | ✅ | 操作人角色 |
| oldStatus | String | ✅ | 原状态 |
| newStatus | String | ✅ | 新状态 |
| reason | String | ❌ | 操作原因 |
| createdAt | DateTime | ✅ | 创建时间 |

---

## ER 图

```
User (用户)
  ├─1:1─ Student (学生)
  ├─1:1─ Teacher (教师)
  └─1:N─ Contest (比赛)

School (学校)
  ├─1:N─ Team (团队)
  ├─1:N─ Teacher (教师)
  ├─1:N─ Student (学生)
  └─1:N─ PrincipalTransferLog (负责人转移日志)

Teacher (教师)
  ├─N:1─ School (学校)
  ├─1:N─ Team (团队) [作为负责人]
  ├─1:N─ Student (学生) [作为主教练]
  ├─1:N─ TaskList (题单)
  └─1:N─ Milestone (里程碑)

Student (学生)
  ├─N:1─ School (学校)
  ├─N:1─ Teacher (教师) [主教练]
  ├─N:M─ Team (团队) [通过 StudentTeam]
  ├─1:N─ ContestResult (比赛结果)
  ├─1:N─ TaskProgress (题目进度)
  └─1:N─ Milestone (里程碑)

Team (团队)
  ├─N:1─ School (学校)
  ├─N:1─ Teacher (教师) [负责人]
  ├─N:M─ Student (学生) [通过 StudentTeam]
  └─1:N─ Contest (比赛)

Contest (比赛)
  ├─N:1─ Team (团队)
  ├─N:1─ User (创建者)
  ├─1:N─ ContestResult (比赛结果)
  ├─1:N─ ContestProblem (比赛题目)
  └─1:N─ ContestResource (比赛资源)

ContestProblem (比赛题目)
  ├─N:1─ Contest (比赛)
  ├─1:N─ ContestProblemScore (单题成绩)
  └─1:N─ ContestResource (题目资源)
```

---

## 数据库操作命令

### 生成 Prisma Client
```bash
cd apps/server
pnpm prisma:generate
```

### 推送 Schema 到数据库
```bash
cd apps/server
pnpm prisma:push
```

### 执行种子数据
```bash
cd apps/server
pnpm prisma:seed
```

### 打开 Prisma Studio
```bash
cd apps/server
npx prisma studio
```

---

## 数据迁移注意事项

1. **学生年级字段变更**:
   - `grade` 字段已删除
   - `enrollmentStage` 字段已删除（入学阶段由学校类型自动推断）
   - `joinDate` 字段已删除
   - 年级通过 `enrollmentYear` + 学校 `schoolType` + 学校 `educationSystem` 动态计算

2. **学生团队关系变更**:
   - 从一对多改为多对多关系
   - 使用 `StudentTeam` 中间表

3. **教师联系方式**:
   - `email` 和 `phone` 至少必填一个（应用层验证）

4. **学校负责人**:
   - `currentPrincipalTeacherId` 必填
   - 负责人转移记录在 `PrincipalTransferLog` 表

---

## 更新日志

### 2026-03-19
- ✅ **重要变更**：删除学生表 `enrollmentStage`、`grade`、`joinDate` 字段
- ✅ 入学阶段改为由学校类型自动推断（小学→小学入学，初中→初中入学，高中→高中入学）

### 2026-03-18
- ✅ **重要变更**：学生表 schoolId 字段改为必填
- ✅ 添加教师联系方式必填验证
- ✅ 学生团队关系改为多对多
- ✅ 学校增加学制字段（educationSystem）
- ✅ 学生增加入学阶段字段（enrollmentStage）
