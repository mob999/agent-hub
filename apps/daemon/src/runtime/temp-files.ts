import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class RuntimeTempFiles {
  #directory: string | undefined;
  #prefix: string;

  constructor(prefix: string) {
    this.#prefix = prefix;
  }

  write(filename: string, content: string): string {
    this.#directory ??= mkdtempSync(join(tmpdir(), this.#prefix));
    const filePath = join(this.#directory, filename);

    writeFileSync(filePath, content, "utf8");

    return filePath;
  }

  cleanup(): void {
    if (this.#directory === undefined) {
      return;
    }

    rmSync(this.#directory, { force: true, recursive: true });
    this.#directory = undefined;
  }
}
