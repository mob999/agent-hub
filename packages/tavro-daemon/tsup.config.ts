import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts", "src/cli.ts", "src/mcp-stdio.ts"],
  format: ["esm"],
  noExternal: [
    "@agent-hub/config",
    "@agent-hub/core",
    "@agent-hub/daemon",
  ],
  outDir: "dist",
  platform: "node",
  shims: false,
  sourcemap: false,
  target: "node20",
});
