import { describe } from "vitest";

// TODO(agent-hub-auth): Add auth route integration tests after test DB isolation is in place.
// Suggested approach:
// 1) Use a dedicated database, e.g. agent_hub_test (never reuse agent_hub dev DB).
// 2) Run migrations before tests.
// 3) Truncate users/sessions between tests.
// 4) Start the API app in-process and use cookie jar assertions.
// 5) Never print raw session tokens in test logs.
describe.todo("auth route integration tests require isolated test database setup");

