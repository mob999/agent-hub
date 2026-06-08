import { mkdir, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const desktopDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(desktopDir, "..", "..");
const sourceSvg = join(repoRoot, "apps", "web", "public", "favicon.svg");
const resourcesDir = join(desktopDir, "resources");
const sourcePng = join(resourcesDir, "icon-source.png");

await mkdir(resourcesDir, { recursive: true });

await sharp(sourceSvg)
  .resize(1024, 1024)
  .png()
  .toFile(sourcePng);

await execFileAsync(process.execPath, [
  require.resolve("electron-icon-builder"),
  "--input",
  sourcePng,
  "--output",
  resourcesDir,
  "--flatten",
], { cwd: desktopDir });

await rm(sourcePng, { force: true });
