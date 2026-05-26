import type { AgentId, IsoDateTime } from "./agent.js";
import type { RunId } from "./run.js";

export type ArtifactId = string;

export type ArtifactStatus = "pending" | "ready" | "failed" | "deleted";

export type ArtifactFileCategory =
  | "html"
  | "markdown"
  | "diff"
  | "image"
  | "text"
  | "binary";

export interface ArtifactFileInfo {
  category: ArtifactFileCategory;
  label: string;
  language: string;
  mimeType: string;
  canApply: boolean;
  canEdit: boolean;
  canPreview: boolean;
}

const extensionInfo = {
  bash: { language: "shell", mimeType: "text/x-shellscript; charset=utf-8" },
  c: { language: "c", mimeType: "text/x-c; charset=utf-8" },
  cc: { language: "cpp", mimeType: "text/x-c++; charset=utf-8" },
  cjs: { language: "javascript", mimeType: "text/javascript; charset=utf-8" },
  cpp: { language: "cpp", mimeType: "text/x-c++; charset=utf-8" },
  cs: { language: "csharp", mimeType: "text/x-csharp; charset=utf-8" },
  css: { language: "css", mimeType: "text/css; charset=utf-8" },
  csv: { language: "plaintext", mimeType: "text/csv; charset=utf-8" },
  env: { language: "plaintext", mimeType: "text/plain; charset=utf-8" },
  go: { language: "go", mimeType: "text/x-go; charset=utf-8" },
  h: { language: "c", mimeType: "text/x-c; charset=utf-8" },
  hpp: { language: "cpp", mimeType: "text/x-c++; charset=utf-8" },
  ini: { language: "ini", mimeType: "text/plain; charset=utf-8" },
  java: { language: "java", mimeType: "text/x-java-source; charset=utf-8" },
  js: { language: "javascript", mimeType: "text/javascript; charset=utf-8" },
  json: { language: "json", mimeType: "application/json; charset=utf-8" },
  jsx: { language: "javascript", mimeType: "text/javascript; charset=utf-8" },
  mjs: { language: "javascript", mimeType: "text/javascript; charset=utf-8" },
  py: { language: "python", mimeType: "text/x-python; charset=utf-8" },
  rs: { language: "rust", mimeType: "text/x-rust; charset=utf-8" },
  sh: { language: "shell", mimeType: "text/x-shellscript; charset=utf-8" },
  sql: { language: "sql", mimeType: "application/sql; charset=utf-8" },
  toml: { language: "toml", mimeType: "application/toml; charset=utf-8" },
  ts: { language: "typescript", mimeType: "text/typescript; charset=utf-8" },
  tsx: { language: "typescript", mimeType: "text/typescript; charset=utf-8" },
  txt: { language: "plaintext", mimeType: "text/plain; charset=utf-8" },
  xml: { language: "xml", mimeType: "application/xml; charset=utf-8" },
  yaml: { language: "yaml", mimeType: "application/yaml; charset=utf-8" },
  yml: { language: "yaml", mimeType: "application/yaml; charset=utf-8" },
  zsh: { language: "shell", mimeType: "text/x-shellscript; charset=utf-8" },
} as const satisfies Record<string, { language: string; mimeType: string }>;

const imageMimeTypes = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
} as const satisfies Record<string, string>;

function extensionFromFilename(filename: string): string {
  const baseName = filename.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  const index = baseName.lastIndexOf(".");

  return index > 0 ? baseName.slice(index + 1) : "";
}

export function inferArtifactFileInfo(input: {
  filename: string;
}): ArtifactFileInfo {
  const extension = extensionFromFilename(input.filename);

  if (extension === "html" || extension === "htm") {
    return {
      category: "html",
      label: "HTML",
      language: "html",
      mimeType: "text/html; charset=utf-8",
      canApply: false,
      canEdit: false,
      canPreview: true,
    };
  }

  if (extension === "md" || extension === "markdown" || extension === "mdx") {
    return {
      category: "markdown",
      label: "Markdown",
      language: "markdown",
      mimeType: "text/markdown; charset=utf-8",
      canApply: true,
      canEdit: true,
      canPreview: true,
    };
  }

  if (extension === "diff" || extension === "patch") {
    return {
      category: "diff",
      label: "Diff",
      language: "diff",
      mimeType: "text/x-diff; charset=utf-8",
      canApply: true,
      canEdit: false,
      canPreview: false,
    };
  }

  const imageMimeType = imageMimeTypes[extension as keyof typeof imageMimeTypes];

  if (imageMimeType !== undefined) {
    return {
      category: "image",
      label: "Image",
      language: "plaintext",
      mimeType: imageMimeType,
      canApply: false,
      canEdit: false,
      canPreview: true,
    };
  }

  const textInfo = extensionInfo[extension as keyof typeof extensionInfo];

  if (textInfo !== undefined) {
    return {
      category: "text",
      label: "File",
      language: textInfo.language,
      mimeType: textInfo.mimeType,
      canApply: true,
      canEdit: true,
      canPreview: false,
    };
  }

  return {
    category: "binary",
    label: "File",
    language: "plaintext",
    mimeType: "application/octet-stream",
    canApply: false,
    canEdit: false,
    canPreview: false,
  };
}

export interface Artifact {
  id: ArtifactId;
  agentId: AgentId;
  runId?: RunId;
  title: string;
  status: ArtifactStatus;
  payload: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
