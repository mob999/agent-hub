import { describe, expect, it } from "vitest";

import { canVerifyPasswordLogin } from "../../src/auth/password.js";

describe("password auth helpers", () => {
  it("does not allow password login for OAuth-only users", () => {
    expect(canVerifyPasswordLogin(null)).toBe(false);
  });

  it("allows password verification when a password hash exists", () => {
    expect(canVerifyPasswordLogin("argon2-hash")).toBe(true);
  });
});
