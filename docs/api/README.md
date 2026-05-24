# AgentHub API 文档总览

## 启动后端

在仓库根目录执行：

```bash
pnpm install
pnpm infra:up
pnpm --filter @agent-hub/api build
pnpm --filter @agent-hub/api start
```

默认地址：`http://localhost:3000`

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
2. 在页面里选择接口（如 `/auth/register`），点击 **Try it out**。  
3. 填请求体后点击 **Execute**。  
4. 登录成功后浏览器会保存 HttpOnly Cookie；后续同源请求（如 `/auth/me`）会自动带 Cookie。  
5. 可直接打开 `http://localhost:3000/openapi.json` 查看原始 OpenAPI JSON。

## 相关文档

- `api-auth-design.md`：鉴权与 OpenAPI 设计说明  
- `auth-usage.md`：业务接口鉴权接入规范

