import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  getSessionExpiresAt,
  hashSessionToken,
} from "./session.js";

describe("session helpers", () => {
  it("createSessionToken returns a non-empty token and two calls are different", () => {
    const tokenA = createSessionToken();
    const tokenB = createSessionToken();

    expect(typeof tokenA).toBe("string");
    expect(tokenA.length).toBeGreaterThan(0);
    expect(tokenA).not.toBe(tokenB);
  });

  it("hashSessionToken is deterministic, changes across inputs, and returns 64-char hex", () => {
    const tokenA = "test-token-a";
    const tokenB = "test-token-b";

    const hashA1 = hashSessionToken(tokenA);
    const hashA2 = hashSessionToken(tokenA);
    const hashB = hashSessionToken(tokenB);

    expect(hashA1).toBe(hashA2);
    expect(hashA1).not.toBe(hashB);
    expect(hashA1).not.toBe(tokenA);
    expect(hashA1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("getSessionExpiresAt returns a Date after now and roughly ttlDays later", () => {
    const before = Date.now();
    const expiresAt = getSessionExpiresAt(30);
    const after = Date.now();

    expect(expiresAt).toBeInstanceOf(Date);
    expect(expiresAt.getTime()).toBeGreaterThan(before);

    const elapsedMs = expiresAt.getTime() - after;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const toleranceMs = 5 * 1000;
    expect(Math.abs(elapsedMs - thirtyDaysMs)).toBeLessThanOrEqual(toleranceMs);
  });
});

