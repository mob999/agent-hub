import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@agent-hub/core": new URL("./packages/core/src/index.ts", import.meta.url)
        .pathname,
      "@agent-hub/server": new URL(
        "./packages/server/src/index.ts",
        import.meta.url,
      ).pathname,
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
    globals: false,
    include: [
      "test/**/*.{test,spec}.{ts,tsx}",
      "apps/**/test/**/*.{test,spec}.{ts,tsx}",
      "packages/**/test/**/*.{test,spec}.{ts,tsx}",
    ],
    passWithNoTests: true,
  },
});
