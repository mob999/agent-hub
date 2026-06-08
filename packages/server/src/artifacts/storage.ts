import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";

type StorageDriver = "local" | "s3";

let cachedS3Client: S3Client | undefined;
let cachedS3ConfigKey: string | undefined;

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
  await writeArtifactObject({
    content,
    storageKey: input.storageKey,
    storageRoot: input.storageRoot,
  });

  return content.byteLength;
}

export async function writeArtifactBuffer(input: {
  content: Buffer;
  storageKey: string;
  storageRoot: string;
}): Promise<number> {
  await writeArtifactObject(input);

  return input.content.byteLength;
}

export async function writeArtifactTextContent(input: {
  content: string;
  storageKey: string;
  storageRoot: string;
}): Promise<number> {
  await writeArtifactObject({
    content: Buffer.from(input.content, "utf8"),
    storageKey: input.storageKey,
    storageRoot: input.storageRoot,
  });

  return Buffer.byteLength(input.content, "utf8");
}

export async function readArtifactContent(input: {
  storageKey: string;
  storageRoot: string;
}): Promise<Buffer> {
  if (getStorageDriver() === "s3") {
    return readS3Object(input.storageKey);
  }

  return readFile(resolveStorageKey(input.storageRoot, input.storageKey));
}

export async function getArtifactContentSize(input: {
  storageKey: string;
  storageRoot: string;
}): Promise<number> {
  if (getStorageDriver() === "s3") {
    return getS3ObjectSize(input.storageKey);
  }

  const info = await stat(resolveStorageKey(input.storageRoot, input.storageKey));

  return info.size;
}

async function writeArtifactObject(input: {
  content: Buffer;
  storageKey: string;
  storageRoot: string;
}): Promise<void> {
  if (getStorageDriver() === "s3") {
    await writeS3Object(input.storageKey, input.content);
    return;
  }

  const filePath = resolveStorageKey(input.storageRoot, input.storageKey);

  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, input.content);
}

function getStorageDriver(): StorageDriver {
  return process.env.AGENTHUB_STORAGE_DRIVER === "s3" ? "s3" : "local";
}

function getS3Config(): {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region: string;
  secretAccessKey: string;
} {
  const endpoint = process.env.AGENTHUB_S3_ENDPOINT;
  const region = process.env.AGENTHUB_S3_REGION;
  const accessKeyId = process.env.AGENTHUB_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AGENTHUB_S3_SECRET_ACCESS_KEY;
  const bucket = process.env.AGENTHUB_S3_BUCKET;

  if (
    endpoint === undefined ||
    region === undefined ||
    accessKeyId === undefined ||
    secretAccessKey === undefined ||
    bucket === undefined
  ) {
    throw new Error("S3 storage is enabled but S3 environment variables are incomplete.");
  }

  return {
    accessKeyId,
    bucket,
    endpoint,
    region,
    secretAccessKey,
  };
}

function getS3Client(): S3Client {
  const config = getS3Config();
  const configKey = [
    config.endpoint,
    config.region,
    config.accessKeyId,
    config.bucket,
  ].join(":");

  if (cachedS3Client !== undefined && cachedS3ConfigKey === configKey) {
    return cachedS3Client;
  }

  cachedS3ConfigKey = configKey;
  cachedS3Client = new S3Client({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint,
    forcePathStyle: true,
    region: config.region,
  });

  return cachedS3Client;
}

function normalizeS3StorageKey(storageKey: string): string {
  const parts = storageKey.split("/").filter(Boolean);

  if (parts.length === 0 || parts.some((part) => part === "..")) {
    throw new Error("Artifact storage key escapes storage root.");
  }

  return parts.join("/");
}

async function writeS3Object(storageKey: string, content: Buffer): Promise<void> {
  const config = getS3Config();

  await getS3Client().send(
    new PutObjectCommand({
      Body: content,
      Bucket: config.bucket,
      Key: normalizeS3StorageKey(storageKey),
    }),
  );
}

async function readS3Object(storageKey: string): Promise<Buffer> {
  const config = getS3Config();

  try {
    const response = await getS3Client().send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: normalizeS3StorageKey(storageKey),
      }),
    );

    return s3BodyToBuffer(response.Body);
  } catch (error) {
    if (isS3NotFoundError(error)) {
      throw missingStorageObjectError(storageKey);
    }

    throw error;
  }
}

async function getS3ObjectSize(storageKey: string): Promise<number> {
  const config = getS3Config();

  try {
    const response = await getS3Client().send(
      new HeadObjectCommand({
        Bucket: config.bucket,
        Key: normalizeS3StorageKey(storageKey),
      }),
    );

    return response.ContentLength ?? 0;
  } catch (error) {
    if (isS3NotFoundError(error)) {
      throw missingStorageObjectError(storageKey);
    }

    throw error;
  }
}

async function s3BodyToBuffer(body: unknown): Promise<Buffer> {
  if (
    typeof body === "object" &&
    body !== null &&
    "transformToByteArray" in body &&
    typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function"
  ) {
    const bytes = await (body as {
      transformToByteArray: () => Promise<Uint8Array>;
    }).transformToByteArray();
    return Buffer.from(bytes);
  }

  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }

  if (body === undefined) {
    return Buffer.alloc(0);
  }

  throw new Error("Unsupported S3 response body.");
}

function isS3NotFoundError(error: unknown): boolean {
  if (error instanceof S3ServiceException) {
    return error.$metadata.httpStatusCode === 404 ||
      error.name === "NoSuchKey" ||
      error.name === "NotFound";
  }

  if (typeof error !== "object" || error === null) {
    return false;
  }

  const maybeError = error as {
    $metadata?: { httpStatusCode?: number };
    name?: string;
  };

  return maybeError.$metadata?.httpStatusCode === 404 ||
    maybeError.name === "NoSuchKey" ||
    maybeError.name === "NotFound";
}

function missingStorageObjectError(storageKey: string): NodeJS.ErrnoException {
  const error = new Error(`Storage object was not found: ${storageKey}`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
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
