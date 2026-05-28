import { describe, it } from "vitest";

describe("auth routes integration (requires isolated test DB)", () => {
  it.skip("register/login/logout/me flow", () => {
    // TODO:
    // 1) Provision isolated test database (e.g. agent_hub_test)
    // 2) Apply migrations before running tests
    // 3) Clean users/sessions tables between test cases
    // 4) Avoid reusing development DATABASE_URL
    // 5) Ensure no raw session token is logged in tests
  });
});
