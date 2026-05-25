# AgentHub 业务接口鉴权接入规范

## 1. 鉴权模块现状

当前后端鉴权能力如下：

- 登录方式：邮箱 + 密码。
- 密码存储：`argon2` hash（不保存明文密码）。
- 登录态：HttpOnly Cookie Session。
- `sessions` 表只保存 `token_hash`，不保存原始 session token。
- `attachAuthUser`：负责从 Cookie 尽量解析当前用户并写入 `c.get("user")`。
- `requireAuth`：负责拒绝未登录请求（401）。
- `c.get("user")` 是后续业务接口获取当前用户身份的唯一可信来源。

## 2. 业务接口接入原则

后续所有用户态业务接口必须遵守：

1. 所有用户态业务接口必须使用 `requireAuth`。
2. 所有用户私有资源必须绑定当前用户。
3. 创建资源时，`userId` 必须来自 `c.get("user").id`。
4. 不允许信任客户端传入的 `userId`、`ownerId`、`createdBy` 等身份字段。
5. 查询单个资源时，不能只按资源 `id` 查询，必须校验资源归属。
6. 更新和删除资源前必须校验资源归属。
7. 资源不存在和资源不属于当前用户时，优先统一返回 404，避免泄露资源是否存在。
8. 响应体不得返回 `passwordHash`、session token、`tokenHash`。
9. 业务日志不得输出原始 session token。
10. 在团队/组织/RBAC 未实现前，不要假设存在跨用户访问权限。

## 3. 推荐资源归属模型

按 AgentHub 后续资源建议如下：

1. `conversations`
- 建议包含 `userId`。
- `conversation` 归属于创建它的用户。

2. `messages`
- 可以通过 `conversationId` 间接归属用户。
- 查询 `message` 前必须先确认其 `conversation` 归属于当前用户。

3. `runs`
- 可以通过 `conversationId` 间接归属用户。
- 创建 `run` 前必须确认 `conversation` 归属于当前用户。

4. `artifacts`
- 建议包含 `ownerUserId`。
- 若 `artifact` 绑定 `run`，也必须通过 `run -> conversation -> user` 校验归属。

5. `daemon / workspace`
- 当前阶段不实现。
- 后续必须单独设计授权边界，不能只依赖普通登录态。

## 4. 错误示例与正确示例

### 查询资源归属校验

错误示例（存在越权风险）：

```ts
where(eq(conversations.id, conversationId))
```

问题：
- 只按 `id` 查询，未绑定当前用户，可能读取到其他用户资源。

正确示例（同时校验资源与归属）：

```ts
where(
  and(
    eq(conversations.id, conversationId),
    eq(conversations.userId, user.id),
  ),
)
```

说明：
- 必须同时校验资源 id 和当前 `user.id`。

### 创建资源 userId 来源

错误示例：

```ts
const userId = body.userId;
```

正确示例：

```ts
const user = c.get("user");
const userId = user.id;
```

说明：
- 资源归属只能来自服务端已认证身份，不信任客户端传入身份字段。

## 5. Hono 路由示例（节选）

> 以下仅为接入方式示例，不是完整业务实现。

```ts
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { requireAuth, type AppBindings } from "../auth/middleware";

export const conversationRoutes = new Hono<AppBindings>();

conversationRoutes.use("*", requireAuth);

conversationRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  const db = c.get("db");

  const result = await db
    .select()
    .from(conversations)
    .where(
      and(
        eq(conversations.id, id),
        eq(conversations.userId, user.id),
      ),
    )
    .limit(1);

  if (!result[0]) {
    return c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Resource not found.",
        },
      },
      404,
    );
  }

  return c.json({ conversation: result[0] });
});
```

## 6. 后续开发检查清单

- [ ] 路由是否挂了 `requireAuth`
- [ ] 是否从 `c.get("user")` 获取当前用户
- [ ] 是否拒绝客户端传入 `userId`
- [ ] 查询是否校验 `userId` 或上级资源归属
- [ ] 更新/删除前是否校验归属
- [ ] 是否避免返回 `passwordHash`/`token`/`tokenHash`
- [ ] 是否避免日志输出原始 token
- [ ] 资源不存在/无权限是否统一处理
- [ ] 是否有测试覆盖未登录、越权、正常访问

## 7. 测试建议

后续业务接口测试至少覆盖：

1. 未登录访问返回 401。
2. 当前用户访问自己的资源成功。
3. 当前用户访问其他用户资源返回 404。
4. 创建资源时忽略 `body.userId`。
5. 更新/删除其他用户资源失败（建议统一 404）。
6. 响应体不泄露敏感字段（`passwordHash`、session token、`tokenHash`）。

