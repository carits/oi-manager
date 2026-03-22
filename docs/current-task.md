# 当前任务

## 状态: 已完成

## 已完成任务：头像上传功能修复

### 问题
`ProfileEditor.tsx` 调用 `apiClient.postFile()` 方法上传头像，但 `apiClient` 类未定义该方法，导致上传静默失败。

### 修复
在 `apiClient` 类中添加 `postFile` 方法：
```typescript
postFile<T>(endpoint: string, formData: FormData, options?: ApiClientOptions): Promise<ApiResponse<T>> {
  return this.request<T>(endpoint, { ...options, method: 'POST', body: formData })
}
```

### 涉及文件
- `apps/web/src/lib/apiClient.ts`

---

## 已完成任务：后端安全与并发止损重构（第三轮）

### 目标
针对团队模块进行权限边界检查和写操作原子性修复，解决并发安全问题。

### 修复内容

#### 1. 权限边界清理
- **问题**: `/api/teams?view=mine` 接口解构了未使用的 `teacherId`/`studentId` query 参数
- **修复**: 移除未使用的参数，明确注释只信任 JWT token 身份
- **位置**: `apps/server/src/routes/teams.ts:768`

#### 2. 创建团队并发修复
- **问题**: count 检查在事务外，并发请求可绕过数量限制
- **修复**: 将 count 检查移入事务，使用数据库原子性保证
- **位置**: `apps/server/src/routes/teams.ts:985-1067`

#### 3. 团队转移并发修复
- **问题**: 多重检查（所有者、数量限制、成员检查）都在事务外
- **修复**: 所有检查和更新在一个事务中完成，防止并发转移
- **位置**: `apps/server/src/routes/teams.ts:2179-2272`

#### 4. 批准申请幂等保护
- **问题**: 先查后更新模式，双击可重复审批
- **修复**: 使用 `updateMany` 条件更新 + `upsert` 保证幂等性
- **位置**: `apps/server/src/routes/teams.ts:1930-2013`

#### 5. 统一异常处理
- **问题**: 没有捕获 Prisma P2002 唯一约束异常
- **修复**: 添加 `PrismaClientKnownRequestError` 导入和 P2002 处理
- **位置**: `apps/server/src/routes/teams.ts` 顶部和邀请成员错误处理

### 涉及文件

**修改文件**：
- `apps/server/src/routes/teams.ts` - 权限清理、并发修复、异常处理

---

## 待处理事项

### 高优先级（P0）
- [x] ~~遗留直连 API 调用迁移到 apiClient~~ ✅ 已完成 (2026-03-23)
- [x] ~~后端安全与并发止损重构~~ ✅ 已完成 (2026-03-23)

### 中优先级（P1）
- [ ] Rating 计算功能实现
- [ ] 榜单导入匹配功能
- [ ] 题单执行闭环功能
- [ ] 测试用例编写

### 低优先级（P2）
- [ ] 家长端功能实现
- [ ] 成绩中心功能
- [ ] 资源管理功能
- [ ] 学生成长报告功能