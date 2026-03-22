# OI Manager V2 项目文档

## 文档目录

- [项目概述](./PROJECT_OVERVIEW.md)
- [架构设计](./architecture/ARCHITECTURE.md)
- [数据库模型](./database/DATABASE_MODELS.md)
- [API 接口文档](./api/API_REFERENCE.md)
- [前端组件库](./components/COMPONENTS.md)
- [开发指南](./DEVELOPMENT_GUIDE.md)
- [部署指南](./DEPLOYMENT.md)

## 快速导航

### 核心模块
- **用户管理**: [API](./api/users.md) | [组件](./components/user-management.md)
- **学校管理**: [API](./api/schools.md) | [组件](./components/school-management.md)
- **教师管理**: [API](./api/teachers.md) | [组件](./components/teacher-management.md)
- **学生管理**: [API](./api/students.md) | [组件](./components/student-management.md)
- **团队管理**: [API](./api/teams.md) | [组件](./components/team-management.md)

### 技术栈
- **前端**: Next.js 14 + React + TypeScript
- **后端**: Express + TypeScript
- **数据库**: SQLite + Prisma ORM
- **包管理**: pnpm + monorepo

## 更新日志

### 2026-03-18
- ✅ 添加教师联系方式必填验证（邮箱或手机号至少一个）
- ✅ 修复学校负责人教师管理页面操作按钮显示问题
- ✅ 为平台管理员账号管理页面添加分页功能
- ✅ 统一超管和平台管理员使用同一套账号管理代码
- ✅ 支持 Markdown 和 LaTeX 渲染（学校公告等）
- ✅ 优化年级分布显示（进度条、百分比）
- ✅ 支持 5-4-3 和 6-3-3 学制动态计算年级
