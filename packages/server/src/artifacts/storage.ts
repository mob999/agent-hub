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

export function conversationArtifactSiteFileStorageKey(input: {
  artifactId: string;
  conversationId: string;
  filePath: string;
}): string {
  return [
    "conversations",
    input.conversationId,
    "artifacts",
    input.artifactId,
    "site",
    ...input.filePath.split("/").filter(Boolean),
  ].join("/");
}

export function conversationArtifactSiteFileRevisionStorageKey(input: {
  artifactId: string;
  conversationId: string;
  filePath: string;
  revisionId: string;
}): string {
  return [
    "conversations",
    input.conversationId,
    "artifacts",
    input.artifactId,
    "site-revisions",
    input.revisionId,
    ...input.filePath.split("/").filter(Boolean),
  ].join("/");
}

export function conversationArtifactRevisionStorageKey(input: {
  artifactId: string;
  conversationId: string;
  filename: string;
  revisionId: string;
}): string {
  return [
    "conversations",
    input.conversationId,
    "artifacts",
    input.artifactId,
    "revisions",
    input.revisionId,
    sanitizeArtifactFilename(input.filename),
  ].join("/");
}

export function conversationDeploymentStoragePrefix(input: {
  conversationId: string;
  deploymentId: string;
}): string {
  return [
    "deployments",
    input.conversationId,
    input.deploymentId,
    "files",
  ].join("/");
}

export function conversationDeploymentFileStorageKey(input: {
  storagePrefix: string;
  filePath: string;
}): string {
  return [
    input.storagePrefix,
    ...input.filePath.split("/").filter(Boolean),
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

export async function writeArtifactBuffer(input: {
  content: Buffer;
  storageKey: string;
  storageRoot: string;
}): Promise<number> {
  const filePath = resolveStorageKey(input.storageRoot, input.storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.content);

  return input.content.byteLength;
}

export async function writeArtifactTextContent(input: {
  content: string;
  storageKey: string;
  storageRoot: string;
}): Promise<number> {
  const filePath = resolveStorageKey(input.storageRoot, input.storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.content, "utf8");

  return Buffer.byteLength(input.content, "utf8");
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

export function createStoredZip(files: Array<{ content: Buffer; path: string }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const file of files) {
    const filename = Buffer.from(file.path, "utf8");
    const crc = crc32(file.content);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(file.content.byteLength, 18);
    localHeader.writeUInt32LE(file.content.byteLength, 22);
    localHeader.writeUInt16LE(filename.byteLength, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, filename, file.content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(file.content.byteLength, 20);
    centralHeader.writeUInt32LE(file.content.byteLength, 24);
    centralHeader.writeUInt16LE(filename.byteLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, filename);

    offset += localHeader.byteLength + filename.byteLength + file.content.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

export function buildArtifactDownloadUrl(input: {
  artifactId: string;
  publicApiBaseUrl: string;
}): string {
  return new URL(`/artifacts/${input.artifactId}/download`, input.publicApiBaseUrl)
    .toString();
}

export function buildArtifactEditorUrl(input: {
  artifactId: string;
  conversationId: string;
  publicWebBaseUrl: string;
}): string {
  return new URL(
    `/editor/${input.conversationId}/${input.artifactId}`,
    input.publicWebBaseUrl,
  ).toString();
}

export function buildDeploymentUrl(input: {
  deploymentId: string;
  publicApiBaseUrl: string;
}): string {
  return new URL(`/deployments/${input.deploymentId}/`, input.publicApiBaseUrl)
    .toString();
}
