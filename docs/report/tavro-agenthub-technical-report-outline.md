# Tavro/AgentHub 课题技术报告大纲

## 文档定位

本文档用于课题提交场景，定位为技术报告，不等同于 `apps/docs` 中面向用户的产品文档。报告主名称使用 **Tavro**，首次出现时说明 Tavro 的原型工程名与代码仓库名为 **AgentHub**。

报告主线以工程完整性为骨架，以多 Agent 协作、本地执行器和产物闭环作为技术创新亮点。目标篇幅约 20 页正文，附录可放关键截图、部署地址、GitHub 仓库、演示视频二维码等材料。

## 摘要

本课题名为 **Agent Hub**，产品实现命名为 **Tavro**。Agent Hub 面向大模型 Agent 从单轮问答走向持续协作、工具调用和自动化执行的趋势，设计并实现了一个基于 IM 交互范式的多 Agent 协作平台。用户可以像使用即时通讯工具一样创建会话、发送消息、@ 不同 Agent，并在同一工作流中查看任务进度、运行日志、生成文件、网页预览和部署记录。

当前 Claude Code、Codex、OpenCode 等 Agent 工具大多以命令行或单机工具形态存在，存在多人协作困难、运行过程不可视、长任务难追踪、本地环境与线上平台难协同、生成产物缺少统一管理等问题。针对这些问题，Agent Hub 将用户交互、控制面、执行面和本地运行环境进行分层设计：前端采用纯静态 Web SPA 与桌面客户端共享工作台界面；后端 API 负责认证、权限、会话历史、Agent 管理和 OpenAPI 路由；Worker 负责长任务队列消费和运行事件持久化；本地 daemon 通过出站连接接入用户电脑上的 Agent runtime；PostgreSQL、Redis 和对象存储分别承担业务数据、队列缓存和产物文件存储。

本课题最终形成了可运行的 Tavro 原型系统，已支持 GitHub 登录、单 Agent 私聊、群聊/项目会话、Agent 管理、Run 状态跟踪、结构化任务卡片、Artifact 工作区、静态站点预览、桌面客户端和本地执行器托管等能力。系统已完成线上部署，并具备演示、测试和后续扩展基础。通过该实现，Agent Hub 验证了以 IM 工作台统一多 Agent 协作、本地执行和产物管理的可行性。

## 第 1 章 绪论

### 1.1 课题背景

- 大模型应用正在从单轮问答走向持续协作、工具调用和自动化执行。
- Claude Code、Codex、OpenCode 等 CLI Agent 具备较强执行能力，但常以单机命令行形态存在。
- 多 Agent 协作需要更好的任务上下文、运行过程可视化、产物管理和用户确认机制。

### 1.2 现有问题

- CLI Agent 难以多人协同，也难以沉淀会话历史和执行过程。
- 长任务运行过程不可视，用户难以判断当前处于排队、执行、失败还是完成状态。
- 本地文件、工具、凭据和线上平台之间缺少安全、可控的连接方式。
- Agent 生成的文件、网页、部署记录和项目变更缺少统一产物管理。

### 1.3 课题目标

- 构建一个可运行的多 Agent IM 工作台。
- 让用户像聊天一样创建会话、发送消息、@ Agent 并查看运行过程。
- 通过 API/Worker/daemon 分层架构支撑长任务执行和本地工具接入。
- 在聊天流中管理消息、任务、文件、预览和部署记录。

### 1.4 主要工作

- 设计聊天式多 Agent 协作模型。
- 实现前后端分层、异步任务执行和实时事件流。
- 实现本地 daemon 连接本机 Claude Code、Codex 等 runtime。
- 实现 Artifact、项目文件、静态站点预览和部署记录。
- 完成线上部署、桌面客户端原型和可演示 Demo。

## 第 2 章 需求分析

### 2.1 用户角色

- 普通用户：发起会话、@ Agent、查看消息、任务和产物。
- Agent/runtime：接收任务、执行工具、回传消息、日志和产物。
- 系统服务：调度任务、保存状态、推送实时事件、管理访问权限。

### 2.2 功能需求

- GitHub 登录与用户会话管理。
- Agent 管理与本地执行器接入。
- 单 Agent 私聊、群聊和项目会话。
- Run 创建、排队、执行、失败、完成等生命周期管理。
- 任务目标、任务分派和结构化卡片消息展示。
- Artifact 展示、编辑、发布与部署记录。
- 桌面客户端托管本地 daemon。

### 2.3 非功能需求

- 长任务不能阻塞 HTTP 请求生命周期。
- 本地执行器必须使用出站连接，避免暴露用户机器端口。
- 前端应是纯静态 SPA，便于部署到 Vercel 等平台。
- 生产环境应支持 Web、API、Worker、数据库、对象存储分离部署。
- 关键状态需要可观测、可恢复、可测试。

## 第 3 章 系统总体设计

### 3.1 总体架构

建议配图：系统架构图。

架构中应包含：

- Web/Desktop 客户端。
- API 控制面。
- Worker 执行面。
- Daemon 本地执行器。
- PostgreSQL。
- Redis。
- Supabase Storage。

### 3.2 分层职责

- UI 客户端只负责交互展示、用户输入、实时事件渲染和产物预览。
- API 负责认证、权限、元数据、OpenAPI 路由、实时通道和任务投递。
- Worker 负责队列消费、Run 执行、daemon gateway、事件写入和缓存失效。
- Daemon 负责本地 runtime 检测、任务执行、MCP relay、workspace 管理和日志回传。

### 3.3 核心数据流

建议配图：Run 生命周期时序图。

核心流程：

1. 用户在会话中发送消息。
2. API 创建 Run，保存 queued 状态并投递队列。
3. Worker 消费 Run，选择本地 daemon 或云端 runtime。
4. Runtime 生成运行事件、消息和 Artifact。
5. API/Worker 持久化数据，并通过实时事件推送给前端。
6. 前端更新消息流、任务状态和产物视图。

### 3.4 Daemon 连接与任务分发

建议配图：Daemon 连接与任务分发图。

- Daemon 与 Worker gateway 建立出站 WebSocket 连接。
- API 为 daemon 设备生成 token，Worker 校验设备身份。
- Worker 根据 Agent/runtime 绑定关系将 Run 分发到对应 daemon。
- Daemon 执行本地 CLI runtime，并将事件流式回传。

## 第 4 章 关键技术与创新点

### 4.1 IM 化多 Agent 协作范式

- Agent 作为聊天成员参与会话。
- 用户可以在群聊中 @ 一个或多个 Agent。
- Orchestrator 可拆分 goal/task，并按任务状态推进协作。
- 自动派发消息使用结构化卡片展示，而不是只依赖纯文本。

### 4.2 本地 daemon 执行模型

- Daemon 通过出站 WebSocket 接入平台，不要求用户开放本地端口。
- Runtime registry 检测本机 Claude Code、Codex 等 CLI 工具。
- Daemon 封装本地进程执行、workspace root、日志采集和取消任务。
- 桌面客户端可托管 `npx @tavro-ai/daemon@latest connect`，降低用户接入成本。

### 4.3 长任务异步执行与实时反馈

- API 和 Worker 解耦，避免 HTTP 请求直接承载长任务。
- Redis 用于队列、缓存和实时协调。
- RunEvent 持久化记录任务运行过程。
- 前端通过 SSE/WebSocket 接收实时更新，展示排队、运行、失败、完成等状态。

### 4.4 Artifact 与产物闭环

- Agent 输出不仅是文本，也包括文件、项目变更、网页预览和部署记录。
- 对象存储解决 API/Worker 多容器环境下本地磁盘不共享的问题。
- Artifact 元数据保存在数据库中，文件内容保存在 Supabase Storage 中。
- 用户可在聊天流中预览、编辑、发布和追踪生成产物。

### 4.5 前端体验设计

- 使用 TanStack Query 管理 server state，降低重复请求和页面切换延迟。
- 用户消息采用 optimistic 入列，提升发送后的即时反馈。
- Welcome dashboard、任务状态聚合和右下角实时提醒改善工作台感知。
- Web 与桌面端共享同一业务界面，桌面端额外提供本地 daemon 托管能力。

## 第 5 章 系统详细设计与实现

### 5.1 前端实现

- 技术栈：Vite、React、TypeScript、Carbon Design System、Tailwind CSS。
- 核心模块：工作台布局、会话侧边栏、消息流、任务页、Artifact 工作区、Daemon 页面。
- 状态管理：TanStack Query 管理服务端数据，本地 state 管理弹窗、草稿、选中态和交互状态。
- 实时更新：接收消息、Run、任务、Artifact 等事件并同步更新 UI。

### 5.2 API 实现

- 技术栈：Hono、Node.js、`@hono/zod-openapi`。
- 路由采用 `createRoute + app.openapi(...)` 暴露 OpenAPI 文档。
- API 模块包括 auth、agents、conversations、runs、daemon、artifacts、deployments、search 和 realtime。
- API 是控制面，负责权限校验、状态持久化和任务投递，不直接执行长任务。

### 5.3 数据层实现

- PostgreSQL 保存用户、OAuth 账户、会话、消息、Run、Artifact、deployment 和 daemon device 等数据。
- Drizzle ORM 管理 schema 与迁移。
- Redis 用于队列、缓存、临时 OAuth state、desktop login code 和实时协调。
- Supabase Storage 存储生成产物、静态站点文件和 deployment 文件。

### 5.4 Worker 实现

- Worker 消费 Run 队列并负责长任务执行。
- 对本地任务，Worker 通过 daemon gateway 将任务分发给在线 daemon。
- Worker 持久化 RunEvent、message、artifact 和 deployment 记录。
- Worker 在数据变更后触发缓存失效和实时事件发布。

### 5.5 Daemon 实现

- Daemon 检测本地 runtime，例如 Claude Code、Codex。
- Daemon 封装 CLI 进程执行、日志流、取消任务和错误归一化。
- MCP stdio relay 负责连接本地 MCP 工具能力。
- Workspace root 限制本地文件访问范围。
- Windows shell/stdin 差异需要在 runtime adapter 层处理。

### 5.6 桌面客户端实现

- Electron 客户端作为 Web 壳复用线上或本地 Web SPA。
- GitHub 登录通过系统浏览器完成，再回跳桌面客户端。
- 桌面端托管本地 `npx @tavro-ai/daemon@latest connect`。
- 客户端支持检查更新，安装包通过 GitHub Release 分发。

## 第 6 章 部署方案与工程化

### 6.1 线上部署拓扑

建议配图：生产部署拓扑图。

- Web：Vercel。
- API/Worker/Redis：Railway。
- Database：Supabase PostgreSQL。
- Object Storage：Supabase Storage。
- Daemon：npm 包 `@tavro-ai/daemon`。
- Desktop：GitHub Release。

### 6.2 环境变量与配置

需要说明的配置包括：

- GitHub OAuth client id、client secret 和 callback URL。
- CORS/Web origin。
- Database URL。
- Redis URL。
- daemon token secret。
- Supabase Storage bucket 和 service role。

### 6.3 CI/CD 流程

建议配图：CI/CD 发布流程图。

- main 分支触发 Vercel/Railway 平台自动部署。
- promote workflow 控制 dev 到 main 的发布入口。
- Supabase migration workflow 负责生产数据库迁移。
- daemon publish workflow 负责 npm 包发版。
- desktop release workflow 负责三端桌面安装包构建和 GitHub Release。

## 第 7 章 系统测试与验证

### 7.1 单元测试

- core 协议类型和纯逻辑。
- server cache/storage。
- API auth/routes。
- daemon runtime/MCP。
- worker daemon gateway。

### 7.2 集成验证

- GitHub 登录。
- 发送消息并创建 Run。
- daemon 在线检测。
- Agent 执行并回传消息。
- Artifact 上传、读取、编辑和发布。
- 静态站点部署预览。

### 7.3 线上 Demo 验证

建议放置：

- Tavro Web 地址。
- Tavro Docs 地址。
- GitHub 仓库地址。
- 演示视频二维码或链接。
- 关键截图：登录页、Welcome、会话、任务、Artifact、Daemon、桌面端。

### 7.4 性能与稳定性说明

- Redis 缓存降低重复读压力。
- TanStack Query 降低前端重复请求和切换等待。
- 对象存储解决多容器本地文件丢失。
- Worker 避免长任务阻塞 API。
- 桌面托管 daemon 降低本地执行器接入失败率。

## 第 8 章 总结与展望

### 8.1 已完成成果

- 完整多 Agent IM 工作台原型。
- Web、API、Worker、Daemon、Desktop 端到端链路。
- 线上部署和可演示 Demo。
- 支持本地执行器、Artifact、任务状态和静态站点预览。

### 8.2 当前不足

- 云端 Agent 执行能力仍可继续增强。
- Artifact 托管可以升级为独立部署服务。
- 桌面端签名、自动更新和本地文件能力仍需完善。
- 权限、审计、团队协作和计费能力尚未产品化。

### 8.3 后续方向

- 支持多 workspace 和团队协作。
- 完善 project file 权限模型。
- 建设独立静态托管服务。
- 扩展更多 Agent runtime adapter。
- 探索移动端远程控制体验。

## 附录建议

### 附录 A 核心数据库表说明

建议列出 users、oauth_accounts、conversations、conversation_messages、conversation_runs、conversation_artifacts、conversation_deployments、daemon_devices 等核心表。

### 附录 B 主要 API 模块列表

建议按 auth、agents、conversations、runs、daemon、artifacts、deployments、search、realtime 等模块整理。

### 附录 C 关键环境变量表

建议列出生产部署所需的 GitHub OAuth、Database、Redis、Web origin、daemon token、Supabase Storage 等变量。

### 附录 D 部署与演示材料

建议包含线上地址、仓库地址、演示账号说明、演示视频二维码或链接。

### 附录 E 关键截图

建议包含登录、Welcome、会话、任务、Artifact、Daemon、桌面端和部署预览截图。

## 写作约定

- 正文优先使用中文。
- 产品名统一使用 Tavro。
- 首次出现时说明：Tavro 的原型工程名与代码仓库名为 AgentHub。
- 本报告独立于 `apps/docs` 产品文档站，建议存放在 `docs/report/`。
- 后续扩写时优先补架构图、时序图、部署图和关键截图。
