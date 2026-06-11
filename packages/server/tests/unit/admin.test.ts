import { describe, expect, it } from "vitest";

import {
  normalizeAdminEmail,
  parseAdminEmails,
} from "../../src";

describe("admin repository helpers", () => {
  it("normalizes admin emails", () => {
    expect(normalizeAdminEmail("  Ada@Example.COM ")).toBe("ada@example.com");
  });

  it("parses comma-separated admin email seeds", () => {
    expect(parseAdminEmails("Ada@example.com, ada@example.com, grace@example.com,,")).toEqual([
      "ada@example.com",
      "grace@example.com",
    ]);
  });
});
