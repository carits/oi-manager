# OI-MANAGER-V2 默认协作规则

## 一、启动时默认加载的项目文档
@docs/PROJECT_OVERVIEW.md
@docs/DATABASE_MODELS.md
@docs/API_REFERENCE.md
@docs/COMPONENTS.md
@docs/README.md

## 二、处理任务时的基本要求
- 开始修改前，先确认当前任务目标与影响范围。
- 涉及数据库结构时，优先参考 `docs/DATABASE_MODELS.md`。
- 涉及接口开发时，优先参考 `docs/API_REFERENCE.md`。
- 涉及前端页面或组件时，优先参考 `docs/COMPONENTS.md`。
- 不明确的目录或模块，先通过 `docs/README.md` 定位。

## 三、完成任务前必须检查
- 更新 `docs/current-task.md`
- 追加写入 `docs/change-log.md`
- 如果本次改动影响了 docs 中的对应说明文档，需要同步更新相关文档
- 不要在未检查文档是否需要同步更新的情况下结束任务

## 四、文件修改原则
- 优先做最小必要修改，不要无关重构
- 修改前先理解现有实现，不要凭空重写
- 新增约定、目录说明、开发规范，优先补充到文档中
- 新的长期协作规范，优先更新本文件