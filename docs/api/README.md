# AgentHub API 文档总览

## 启动后端

在仓库根目录执行：

```bash
pnpm install
pnpm infra:up
pnpm --filter @agent-hub/api build
```

然后启动 API（必须带环境变量）：

```bash
DATABASE_URL='postgres://agent_hub:agent_hub@localhost:5432/agent_hub' \
REDIS_URL='redis://localhost:6379' \
NODE_ENV=development \
PORT=3000 \
AUTH_SESSION_COOKIE=agent_hub_session \
AUTH_SESSION_TTL_DAYS=30 \
AUTH_COOKIE_SECURE=false \
pnpm --filter @agent-hub/api start
```

默认地址：`http://localhost:3000`

## 环境变量注意事项（重要）

`@agent-hub/api` 启动时会调用 `loadApiEnv()`，其中 `DATABASE_URL` 是必填。  
如果没有设置，会报错：

`Invalid input: expected string, received undefined (DATABASE_URL)`

推荐做法是先加载 `.env.example`：

```bash
set -a
source .env.example
set +a
pnpm --filter @agent-hub/api start
```

### `set -a` / `set +a` 是什么

- `set -a`：让后续定义/加载的 shell 变量自动导出为环境变量（export）。
- `source .env.example`：把文件里的键值对加载到当前 shell。
- `set +a`：关闭“自动导出”模式，避免影响后续命令。

一句话：这三行是为了让 `.env.example` 里的变量真正传给 Node 进程。

## 访问路径

- 健康检查：`GET /health`
- OpenAPI 描述：`GET /openapi.json`
- Swagger UI：`GET /docs`
- 鉴权接口：
  - `POST /auth/register`
  - `POST /auth/login`
  - `POST /auth/logout`
  - `GET /auth/me`
- 临时调试：`GET /debug/protected`

## Swagger UI 怎么用

1. 打开 `http://localhost:3000/docs`。  
2. 选择接口（如 `/auth/register`），点击 **Try it out**。  
3. 填写请求体，点击 **Execute**。  
4. 登录成功后浏览器会保存 HttpOnly Cookie；后续同源请求（如 `/auth/me`）会自动带 Cookie。  
5. 也可以直接访问 `http://localhost:3000/openapi.json` 查看原始 OpenAPI JSON。

## 相关文档

- `api-auth-design.md`：后端鉴权与 OpenAPI 设计说明
- `auth-usage.md`：业务接口鉴权接入规范

