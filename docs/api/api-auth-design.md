# AgentHub API 鉴权与文档方案（OpenAPIHono）

## 1. 当前 API 技术栈

- Web 框架：Hono
- OpenAPI 路由描述：`@hono/zod-openapi`（`OpenAPIHono` + `createRoute`）
- Swagger UI：`@hono/swagger-ui`
- Schema 与校验：Zod（通过 `@hono/zod-openapi` 导出的 `z`）
- 数据访问：Drizzle ORM
- 数据库：PostgreSQL
- 登录态：HttpOnly Cookie Session

## 2. Zod 与 @hono/zod-openapi 的区别

- Zod：负责运行时数据校验与类型推导。
- `@hono/zod-openapi`：在 Zod 基础上提供 OpenAPI 路由描述能力，可通过 `createRoute` 声明请求/响应文档，并由 `app.doc()` 自动生成 OpenAPI JSON。
- `@hono/swagger-ui`：将 `/openapi.json` 渲染为可交互文档页面（`/docs`）。

## 3. 当前代码模块职责

### `packages/config/src/env.ts`
- 读取并校验 API 环境变量（`NODE_ENV`、`PORT`、`DATABASE_URL`、`REDIS_URL`、session cookie 配置等）。

### `packages/db/src/schema/auth.ts`
- 定义 `users` 和 `sessions` 表结构、索引、外键。

### `packages/db/src/client.ts`
- 提供 `createDb(databaseUrl)`，创建 Drizzle DB 实例。

### `apps/api/src/auth/session.ts`
- 生成 session token
- hash token
- 创建 session
- 根据 token 查用户（校验过期/撤销）
- 撤销 session

### `apps/api/src/auth/middleware.ts`
- `attachAuthUser`：从 Cookie 解析当前用户并注入 `c.get("user")`
- `requireAuth`：拒绝未登录请求（401）

### `apps/api/src/schemas/common.ts`
- 通用响应 schema：`ErrorResponseSchema`、`OkResponseSchema`、`HealthResponseSchema`

### `apps/api/src/schemas/auth.ts`
- 鉴权请求/响应 schema：`UserSchema`、`RegisterRequestSchema`、`LoginRequestSchema`、`AuthUserResponseSchema`

### `apps/api/src/routes/auth.ts`
- 注册、登录、登出、当前用户路由
- 通过 `OpenAPIHono` + `createRoute` 自动生成 OpenAPI 路由文档

### `apps/api/src/index.ts`
- 创建 API app（`OpenAPIHono`）
- 注入 env/db
- 配置 CORS
- 挂载 `attachAuthUser`
- 暴露 `/openapi.json` 与 `/docs`
- 挂载 `/auth`、`/health`、`/debug/protected`

## 4. 当前路由列表

### `GET /health`
- 是否需要登录：否
- 请求体：无
- 返回值：`{ ok: true }`
- 用途：服务健康检查

### `GET /openapi.json`
- 是否需要登录：否
- 请求体：无
- 返回值：OpenAPI JSON
- 用途：文档源

### `GET /docs`
- 是否需要登录：否
- 请求体：无
- 返回值：Swagger UI 页面
- 用途：接口浏览与调试

### `POST /auth/register`
- 是否需要登录：否
- 请求体：`email/password/name`
- 返回值：`{ user }`
- 用途：注册并自动登录（发放 Cookie Session）

### `POST /auth/login`
- 是否需要登录：否
- 请求体：`email/password`
- 返回值：`{ user }`
- 用途：登录并发放 Cookie Session

### `POST /auth/logout`
- 是否需要登录：否（允许无 Cookie 也返回 ok）
- 请求体：无
- 返回值：`{ ok: true }`
- 用途：撤销当前 session 并清理 Cookie

### `GET /auth/me`
- 是否需要登录：是（`requireAuth`）
- 请求体：无
- 返回值：`{ user }`
- 用途：获取当前登录用户

### `GET /debug/protected`
- 是否需要登录：是（`requireAuth`）
- 请求体：无
- 返回值：`{ user }`
- 用途：临时调试鉴权链路（上线前建议移除或限制）

## 5. 鉴权流程

### 注册流程
`body -> zod 校验 -> email 小写化 -> 查重 -> argon2.hash -> users 插入 -> createSession -> Set-Cookie -> 返回 user`

### 登录流程
`body -> zod 校验 -> email 小写化 -> 查用户 -> argon2.verify -> createSession -> Set-Cookie -> 返回 user`

### 请求鉴权流程
`浏览器带 Cookie -> attachAuthUser 读取 Cookie -> hash token -> 查 sessions/users -> 校验 expiresAt/revokedAt -> c.set("user") -> requireAuth 判断`

### 登出流程
`读取 Cookie -> revokeSession 设置 revokedAt -> deleteCookie -> 返回 ok`

## 6. Cookie 与 Swagger UI 说明

- 登录态使用 HttpOnly Cookie。
- Swagger UI 不能手工读取 HttpOnly token 文本。
- 但同源访问 `/docs` 时，登录接口成功后，浏览器后续请求会自动携带 Cookie。
- 跨域前端访问 API 时，前端请求必须 `credentials: "include"`。
- 后端 CORS 必须开启 `credentials: true`。

## 7. 安全约束

- 不返回 `passwordHash`
- 不返回 session token
- 不返回 `tokenHash`
- `sessions` 表只保存 `token_hash`
- 登录失败不区分“邮箱不存在”和“密码错误”
- 后续业务接口中，`userId` 只能来自 `c.get("user").id`
- 不信任 `body.userId`

