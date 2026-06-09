# Tavro/AgentHub 课题技术报告大纲

## 文档定位

本文档用于课题提交场景，定位为技术报告，不等同于 `apps/docs` 中面向用户的产品文档。报告主名称使用 **Tavro**，首次出现时说明 Tavro 的原型工程名与代码仓库名为 **AgentHub**。

报告主线以工程完整性为骨架，以多 Agent 协作、本地执行器、产物闭环和 AI 辅助工程协作方法作为技术创新亮点。目标篇幅约 20 页正文，附录可放关键截图、部署地址、GitHub 仓库、演示视频二维码等材料。

## 摘要

本课题名为 **Agent Hub**，产品实现命名为 **Tavro**。Agent Hub 面向大模型 Agent 从单轮问答走向持续协作、工具调用和自动化执行的趋势，设计并实现了一个基于 IM 交互范式的多 Agent 协作平台。用户可以像使用即时通讯工具一样创建会话、发送消息、@ 不同 Agent，并在同一工作流中查看任务进度、运行日志、生成文件、网页预览和部署记录。

当前 Claude Code、Codex、OpenCode 等 Agent 工具大多以命令行或单机工具形态存在，存在多人协作困难、运行过程不可视、长任务难追踪、本地环境与线上平台难协同、生成产物缺少统一管理等问题。针对这些问题，Agent Hub 将用户交互、控制面、执行面和本地运行环境进行分层设计：前端采用纯静态 Web SPA 与桌面客户端共享工作台界面；后端 API 负责认证、权限、会话历史、Agent 管理和 OpenAPI 路由；Worker 负责长任务队列消费和运行事件持久化；本地 daemon 通过出站连接接入用户电脑上的 Agent runtime；PostgreSQL、Redis 和对象存储分别承担业务数据、队列缓存和产物文件存储。

本课题最终形成了可运行的 Tavro 原型系统，已支持 GitHub 登录、单 Agent 私聊、群聊/项目会话、Agent 管理、Run 状态跟踪、结构化任务卡片、Artifact 工作区、静态站点预览、桌面客户端和本地执行器托管等能力。系统已完成线上部署，并具备演示、测试和后续扩展基础。通过该实现，Agent Hub 验证了以 IM 工作台统一多 Agent 协作、本地执行和产物管理的可行性。

## 第 1 章 绪论

### 1.1 课题背景

近年来，大语言模型应用正在从单轮问答逐步发展为能够理解上下文、调用工具、执行多步骤任务的 Agent 系统。与传统聊天机器人相比，Agent 不再只负责生成文本回答，而是可以结合代码仓库、命令行工具、文件系统、外部 API 和自动化流程完成更复杂的工作。例如在软件开发场景中，Agent 可以阅读代码、定位问题、生成补丁、运行测试并给出修改说明；在内容生产场景中，Agent 可以生成文档、网页、演示材料和结构化产物。

随着 Claude Code、Codex、OpenCode 等工具出现，命令行形态的 AI Agent 已经具备较强的本地执行能力。这类工具可以直接访问用户机器上的代码仓库和开发环境，因此在真实工程任务中具有很高价值。然而，它们通常以单机、单用户、单任务方式运行，交互入口主要是终端或独立 CLI，会话历史、任务状态、执行日志和生成产物往往分散在不同位置，难以形成面向团队协作和长期工作的统一工作台。

另一方面，真实工作任务通常不是一次请求即可完成。用户可能需要同时调动多个 Agent，分别承担规划、编码、测试、文档、部署等职责；也可能需要在任务执行过程中查看进度、确认中间结果、追踪失败原因，并最终对生成文件或部署结果进行管理。因此，多 Agent 协作不仅需要模型能力，也需要一套稳定的工程平台来组织会话、任务、运行状态和产物生命周期。

本课题基于上述背景提出 **Agent Hub**，并将产品实现命名为 **Tavro**。课题希望以即时通讯工具中用户熟悉的会话交互为基础，把 Agent 作为聊天成员接入工作流，让用户通过创建会话、发送消息和 @ Agent 的方式发起任务，并在同一界面中持续查看运行事件、任务拆分、生成产物和部署结果。

### 1.2 现有问题

现有 CLI Agent 在单人本地任务中表现直接高效，但当任务复杂度提升后，会暴露出运行过程不可视的问题。一个 Agent 任务可能持续数分钟甚至更久，期间会经历排队、启动、读取上下文、调用工具、生成结果、失败重试等状态。如果这些状态只散落在终端输出中，用户很难清晰判断任务当前进展，也难以在任务结束后回溯关键日志和决策过程。

其次，CLI Agent 通常以本地工作目录为中心，缺少面向协作的会话组织能力。用户可能在不同项目、不同终端窗口或不同工具之间反复切换，但任务上下文、聊天历史、运行事件和最终产物没有统一沉淀。当多个 Agent 参与同一个目标时，任务分派、执行顺序和结果汇总更容易变得混乱，难以形成稳定的多 Agent 协作体验。

第三，本地环境与线上平台之间存在天然割裂。本地机器保存着代码仓库、开发工具、登录凭据和私有文件，而线上系统更适合承担用户管理、任务调度、实时同步和持久化记录。如果直接把执行能力放在浏览器或普通 HTTP 请求中，会带来安全边界不清、长任务阻塞和本地资源访问困难等问题；如果完全依赖本地 CLI，又难以提供统一的 Web 工作台和远程可见状态。

最后，Agent 生成的产物缺少统一生命周期管理。一次任务可能产生文本回复、代码变更、附件、网页预览、部署记录和项目文件修改。如果这些结果只保存在终端输出或临时目录中，用户难以预览、编辑、发布、复用或追踪历史版本。因此，需要一个能够同时管理消息、任务、运行记录和生成产物的平台，把 Agent 的执行结果转化为可持续使用的工程资产。

### 1.3 课题目标

本课题的目标是设计并实现一个名为 **Agent Hub** 的多 Agent 协作平台，产品实现名为 **Tavro**。系统以 IM 聊天作为核心交互范式，让用户可以像使用聊天工具一样创建工作会话、发送任务消息、@ 一个或多个 Agent，并在会话中持续查看任务拆分、运行进度、Agent 回复和生成产物。

在工程实现上，课题目标不是简单封装某一个 CLI Agent，而是构建一套可扩展的 Agent 工作台。系统需要支持用户认证、Agent 管理、会话历史、Run 生命周期、任务状态、实时事件、Artifact 管理和静态站点预览等能力；同时还需要支持桌面客户端和本地执行器，使用户本机已有的 Claude Code、Codex 等 runtime 能够安全接入线上工作台。

为支撑上述目标，系统采用 Web、API、Worker、daemon 分层架构。Web 和桌面端负责交互展示；API 作为控制面负责认证、权限、会话和元数据；Worker 在 HTTP 请求之外执行长任务并持久化运行事件；daemon 作为用户本机的轻量执行器，通过出站连接接收授权任务并调用本地 runtime。通过这种分层方式，系统既能保持线上平台的可访问性和可管理性，又能利用本地工具链完成真实工程任务。

最终，Agent Hub 希望验证一种以 IM 工作台统一多 Agent 协作、本地执行和产物管理的技术路线，使 Agent 不再只是分散的命令行工具，而是可以进入有状态、可追踪、可协作、可部署的工程工作流。

### 1.4 主要工作

围绕上述目标，本文主要完成以下工作：

- 设计聊天式多 Agent 协作模型。系统将 Agent 抽象为会话成员，支持单 Agent 私聊、群聊、项目会话和 @ Agent 交互，并通过目标、任务和结构化卡片承载多 Agent 分工结果。
- 实现分层系统架构与实时任务链路。系统拆分为 Web/Desktop、API、Worker、daemon、数据库、Redis 和对象存储等部分，使长任务执行、状态持久化和实时推送从普通 HTTP 请求中解耦。
- 实现本地 daemon 与桌面端托管能力。Daemon 负责检测和调用用户本机的 Claude Code、Codex 等 runtime；桌面客户端在复用 Web 工作台的基础上，提供本地执行器启动、状态查看和更新提醒等能力。
- 实现 Artifact 与部署预览产物闭环。系统支持在聊天流中展示生成文件、项目变更、网页预览和部署记录，并通过对象存储解决线上多容器环境中的产物共享问题。
- 完成线上部署、测试验证和演示闭环。系统已部署到 Vercel、Railway、Supabase 等平台，并通过单元测试、集成验证和线上 Demo 证明主要流程可运行。
- 沉淀面向 AI Agent 协作开发的工程规范。项目通过 `AGENTS.md` 和 `skills/` 记录架构边界、开发流程、部署经验和常见排障方法，为后续 AI Agent 参与维护和扩展提供稳定上下文。

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

## 第 7 章 AI 协作方法与工程规范

### 7.1 方法设计背景

- 本课题本身是多 Agent 协作平台，同时开发过程也大量使用 AI Agent 辅助编码、排障、文档和部署。
- 为避免 AI Agent 在复杂 monorepo 中偏离架构边界，需要将项目知识、工程约束和常用流程显式文档化。
- 项目采用“项目级总规范 + 任务型技能文档”的方式，让 AI Agent 能够持续复用上下文，而不是每次从零理解仓库。

### 7.2 `AGENTS.md` 项目级协作契约

- `AGENTS.md` 记录 Tavro/AgentHub 的产品模型、架构原则、运行边界和代码组织方式。
- 文档明确 Web、API、Worker、Daemon、Desktop、packages 之间的职责边界，减少 AI Agent 把逻辑放错层的风险。
- 文档规定 API route 使用 OpenAPI `createRoute` 风格、后端领域逻辑优先放入 `packages/server`、共享协议放入 `packages/core`。
- 文档还沉淀测试约定、本地基础设施、当前实现状态和后续优先级，作为 AI Agent 接手任务前的公共上下文。

### 7.3 `skills/` 任务型技能文档

- `skills/` 目录将高频任务沉淀为可复用工作流，每个 skill 使用 `SKILL.md` 描述触发场景、核心原则、常用流程、验证命令和易错点。
- 当前项目包含开发流程、前端体验、生产部署、CI 排障、daemon 发版等技能。
- skill 与 `AGENTS.md` 的关系是分层互补：`AGENTS.md` 约束全局架构和边界，skill 约束具体任务执行方式。
- 这种方法让后续 AI Agent 在处理 UI 打磨、部署、发版、CI 失败等任务时，能够快速进入正确工作模式。

### 7.4 AI 协作开发流程

- 需求不明确时先设计计划，再进入实现。
- 实现前先阅读相关代码和仓库状态，避免凭空假设。
- 修改保持小步提交，每次变更后运行对应范围的 lint、typecheck、test 或全量 `pnpm check`。
- 涉及部署、OAuth、CI、daemon 发版等高风险任务时，优先通过 skill 中的检查清单执行。
- 所有关键经验在问题解决后反向沉淀到 `AGENTS.md` 或对应 skill 中，形成持续改进闭环。

### 7.5 方法价值

- 降低大型 TypeScript monorepo 中 AI 协作的上下文损耗。
- 提升跨前端、后端、worker、daemon、桌面端任务的一致性。
- 将一次性排障经验转化为可复用流程，减少重复错误。
- 为课题本身提供一种“用 AI Agent 构建 AI Agent 平台”的工程实践样例。

## 第 8 章 系统测试与验证

### 8.1 单元测试

- core 协议类型和纯逻辑。
- server cache/storage。
- API auth/routes。
- daemon runtime/MCP。
- worker daemon gateway。

### 8.2 集成验证

- GitHub 登录。
- 发送消息并创建 Run。
- daemon 在线检测。
- Agent 执行并回传消息。
- Artifact 上传、读取、编辑和发布。
- 静态站点部署预览。

### 8.3 线上 Demo 验证

建议放置：

- Tavro Web 地址。
- Tavro Docs 地址。
- GitHub 仓库地址。
- 演示视频二维码或链接。
- 关键截图：登录页、Welcome、会话、任务、Artifact、Daemon、桌面端。

### 8.4 性能与稳定性说明

- Redis 缓存降低重复读压力。
- TanStack Query 降低前端重复请求和切换等待。
- 对象存储解决多容器本地文件丢失。
- Worker 避免长任务阻塞 API。
- 桌面托管 daemon 降低本地执行器接入失败率。

## 第 9 章 总结与展望

### 9.1 已完成成果

- 完整多 Agent IM 工作台原型。
- Web、API、Worker、Daemon、Desktop 端到端链路。
- 线上部署和可演示 Demo。
- 支持本地执行器、Artifact、任务状态和静态站点预览。
- 形成 `AGENTS.md` 与项目 skills 结合的 AI 协作开发方法。

### 9.2 当前不足

- 云端 Agent 执行能力仍可继续增强。
- Artifact 托管可以升级为独立部署服务。
- 桌面端签名、自动更新和本地文件能力仍需完善。
- 权限、审计、团队协作和计费能力尚未产品化。
- AI 协作规范仍需要随着项目演进持续补充和验证。

### 9.3 后续方向

- 支持多 workspace 和团队协作。
- 完善 project file 权限模型。
- 建设独立静态托管服务。
- 扩展更多 Agent runtime adapter。
- 探索移动端远程控制体验。
- 将更多项目经验沉淀为可复用 skill，并探索自动化触发机制。

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

### 附录 F AI 协作规范材料

建议摘录或引用 `AGENTS.md`、关键 `SKILL.md`、AI 协作任务流程和典型问题修复记录。

## 写作约定

- 正文优先使用中文。
- 产品名统一使用 Tavro。
- 首次出现时说明：Tavro 的原型工程名与代码仓库名为 AgentHub。
- 本报告独立于 `apps/docs` 产品文档站，建议存放在 `docs/report/`。
- 后续扩写时优先补架构图、时序图、部署图和关键截图。
