import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function sanitizeArtifactFilename(filename: string): string {
  const base = path.basename(filename).replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_");
  const trimmed = base.trim();

  return trimmed.length > 0 ? trimmed.slice(0, 255) : "artifact";
}

export function conversationArtifactStorageKey(input: {
  artifactId: string;
  conversationId: string;
  filename: string;
}): string {
  return [
    "conversations",
    input.conversationId,
    "artifacts",
    input.artifactId,
    sanitizeArtifactFilename(input.filename),
  ].join("/");
}

export function resolveStorageKey(storageRoot: string, storageKey: string): string {
  const normalizedKey = storageKey.split("/").filter(Boolean).join(path.sep);
  const root = path.resolve(storageRoot);
  const resolved = path.resolve(root, normalizedKey);

  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Artifact storage key escapes storage root.");
  }

  return resolved;
}

export async function writeArtifactContent(input: {
  contentBase64: string;
  storageKey: string;
  storageRoot: string;
}): Promise<number> {
  const content = Buffer.from(input.contentBase64, "base64");
  const filePath = resolveStorageKey(input.storageRoot, input.storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);

  return content.byteLength;
}

export async function readArtifactContent(input: {
  storageKey: string;
  storageRoot: string;
}): Promise<Buffer> {
  return readFile(resolveStorageKey(input.storageRoot, input.storageKey));
}

export async function getArtifactContentSize(input: {
  storageKey: string;
  storageRoot: string;
}): Promise<number> {
  const info = await stat(resolveStorageKey(input.storageRoot, input.storageKey));

  return info.size;
}

export function buildArtifactDownloadUrl(input: {
  artifactId: string;
  publicApiBaseUrl: string;
}): string {
  return new URL(`/artifacts/${input.artifactId}/download`, input.publicApiBaseUrl)
    .toString();
}
