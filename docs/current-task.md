# 当前任务

## 状态: 已完成

## 已完成任务：个人卡片功能（页面导航版）

### 需求
设计个人卡片功能，展示用户信息给其他人查看

### 完成内容

1. **后端 API**（之前已完成）
   - `GET /api/users/:userId/profile?userType=teacher|student` 获取用户公开信息
   - 返回：头像、姓名、用户名、角色、学校、个人简介

2. **前端页面**（新实现）
   - `/profile/student/[id]/page.tsx` - 学生个人主页
   - `/profile/teacher/[id]/page.tsx` - 教师个人主页
   - 使用独立页面导航，而非弹窗

3. **入口添加**
   - 团队成员列表：点击成员头像或姓名跳转到个人主页
   - 学校学生列表：点击学生姓名跳转到个人主页
   - 学校教师列表：点击教师姓名跳转到个人主页

4. **代码清理**
   - 删除了 `ProfileCard.tsx` 弹窗组件
   - 删除了 `ProfileCardProvider.tsx` 上下文
   - 删除了 `profile/index.ts`
   - 移除了 `AppShell.tsx` 中的 Provider 包裹

### 涉及文件
- `apps/web/src/app/profile/student/[id]/page.tsx` - 新建
- `apps/web/src/app/profile/teacher/[id]/page.tsx` - 新建
- `apps/web/src/components/profile/` - 删除整个目录
- `apps/web/src/components/AppShell.tsx` - 移除 Provider
- `apps/web/src/components/team/TeamMemberList.tsx` - 使用 Link 导航
- `apps/web/src/components/team/TeamDetailPage.tsx` - 移除 useProfileCard
- `apps/web/src/app/teacher/school/components/StudentsTab.tsx` - 使用 router.push
- `apps/web/src/app/teacher/school/components/TeachersTab.tsx` - 使用 router.push

## 待处理事项

- [ ] 数据迁移：将旧表数据迁移到 TeamMember 表
- [ ] 清理旧表：迁移完成后删除 StudentTeam, TeacherTeam, TeamAdmin 表
- [ ] 清理 Team 表的 ownerId, ownerType 字段
- [ ] 比赛管理功能完善
- [ ] Rating 系统完善
- [ ] 题单管理
- [ ] 成绩中心
- [ ] 资源管理
- [ ] 学生成长报告