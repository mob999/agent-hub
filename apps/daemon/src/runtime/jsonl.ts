export type JsonLineParseResult =
  | {
      ok: true;
      value: unknown;
    }
  | {
      error: Error;
      line: string;
      ok: false;
    };

export class LineDecoder {
  #buffer = "";

  push(chunk: Buffer | string): string[] {
    this.#buffer += chunk.toString();

    const lines = this.#buffer.split(/\r?\n/);
    this.#buffer = lines.pop() ?? "";

    return lines.filter((line) => line.length > 0);
  }

  flush(): string | undefined {
    if (this.#buffer.length === 0) {
      return undefined;
    }

    const line = this.#buffer;
    this.#buffer = "";
    return line;
  }
}

export function parseJsonLine(line: string): JsonLineParseResult {
  try {
    return {
      ok: true,
      value: JSON.parse(line) as unknown,
    };
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause : new Error(String(cause)),
      line,
      ok: false,
    };
  }
}

