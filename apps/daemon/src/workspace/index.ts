import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  agentWorkspaceDirectoryNames,
  agentWorkspaceManifestFileName,
  agentWorkspaceMetadataDirectory,
  agentWorkspaceRuntimeFileName,
  type AgentId,
  type AgentRuntimeConfig,
  type AgentWorkspace,
  type AgentWorkspaceManifest,
  type DaemonDeviceId,
  type RunId,
} from "@agent-hub/core";

import { initializeAgentMemory } from "../memory";

export interface AgentWorkspaceLocator {
  agentId: AgentId;
  daemonDeviceId: DaemonDeviceId;
}

export interface InitializeAgentWorkspaceInput extends AgentWorkspaceLocator {
  workspacePath: string;
  runtime: AgentRuntimeConfig;
  createdAt?: Date;
}

export interface InitializedAgentWorkspace {
  workspace: AgentWorkspace;
  manifest: AgentWorkspaceManifest;
  runtime: AgentRuntimeConfig;
  paths: AgentWorkspaceLayoutPaths;
}

export interface AgentWorkspaceLayoutPaths {
  root: string;
  metadata: string;
  manifest: string;
  runtime: string;
  memory: string;
  skills: string;
  files: string;
  runs: string;
  artifacts: string;
  cache: string;
}

const safeWorkspaceSegmentPattern = /^[A-Za-z0-9._-]+$/;

function formatJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toIsoDateTime(date: Date): string {
  return date.toISOString();
}

export function assertSafeWorkspaceSegment(segment: string): void {
  if (!safeWorkspaceSegmentPattern.test(segment)) {
    throw new Error(`Unsafe workspace path segment: ${segment}`);
  }
}

export function getAgentWorkspacePath(
  basePath: string,
  locator: AgentWorkspaceLocator,
): string {
  assertSafeWorkspaceSegment(locator.daemonDeviceId);
  assertSafeWorkspaceSegment(locator.agentId);

  return path.join(basePath, locator.daemonDeviceId, locator.agentId);
}

export function getAgentWorkspaceLayoutPaths(
  workspacePath: string,
): AgentWorkspaceLayoutPaths {
  const root = path.resolve(workspacePath);
  const metadata = path.join(root, agentWorkspaceMetadataDirectory);

  return {
    root,
    metadata,
    manifest: path.join(metadata, agentWorkspaceManifestFileName),
    runtime: path.join(metadata, agentWorkspaceRuntimeFileName),
    memory: path.join(root, "memory"),
    skills: path.join(root, "skills"),
    files: path.join(root, "files"),
    runs: path.join(root, "runs"),
    artifacts: path.join(root, "artifacts"),
    cache: path.join(root, "cache"),
  };
}

export function isPathInsideWorkspace(
  workspacePath: string,
  targetPath: string,
): boolean {
  const root = path.resolve(workspacePath);
  const target = path.resolve(targetPath);
  const relativePath = path.relative(root, target);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export function assertPathInsideWorkspace(
  workspacePath: string,
  targetPath: string,
): void {
  if (!isPathInsideWorkspace(workspacePath, targetPath)) {
    throw new Error(`Path escapes agent workspace: ${targetPath}`);
  }
}

export function resolveWorkspacePath(
  workspacePath: string,
  ...segments: string[]
): string {
  const resolvedPath = path.resolve(workspacePath, ...segments);
  assertPathInsideWorkspace(workspacePath, resolvedPath);
  return resolvedPath;
}

export async function initializeAgentWorkspace(
  input: InitializeAgentWorkspaceInput,
): Promise<InitializedAgentWorkspace> {
  const createdAt = toIsoDateTime(input.createdAt ?? new Date());
  const paths = getAgentWorkspaceLayoutPaths(input.workspacePath);
  assertPathInsideWorkspace(paths.root, paths.root);

  for (const directoryName of agentWorkspaceDirectoryNames) {
    await mkdir(path.join(paths.root, directoryName), { recursive: true });
  }

  const manifest: AgentWorkspaceManifest = {
    schemaVersion: 1,
    agentId: input.agentId,
    daemonDeviceId: input.daemonDeviceId,
    syncMode: "local-only",
    createdAt,
  };
  const runtime: AgentRuntimeConfig = {
    ...input.runtime,
    updatedAt: input.runtime.updatedAt || createdAt,
  };

  await writeFile(paths.manifest, formatJson(manifest), "utf8");
  await writeFile(paths.runtime, formatJson(runtime), "utf8");
  await initializeAgentMemory(paths.root, input.createdAt);

  return {
    workspace: {
      agentId: input.agentId,
      daemonDeviceId: input.daemonDeviceId,
      workspacePath: paths.root,
      status: "ready",
      syncMode: "local-only",
      createdAt,
      updatedAt: createdAt,
    },
    manifest,
    runtime,
    paths,
  };
}

export async function readAgentWorkspaceManifest(
  workspacePath: string,
): Promise<AgentWorkspaceManifest> {
  const paths = getAgentWorkspaceLayoutPaths(workspacePath);
  const manifest = JSON.parse(await readFile(paths.manifest, "utf8")) as
    | AgentWorkspaceManifest
    | undefined;

  if (manifest?.schemaVersion !== 1) {
    throw new Error(`Unsupported agent workspace manifest: ${paths.manifest}`);
  }

  return manifest;
}

export async function createRunWorkspace(
  workspacePath: string,
  runId: RunId,
): Promise<string> {
  assertSafeWorkspaceSegment(runId);

  const runWorkspacePath = resolveWorkspacePath(workspacePath, "runs", runId);
  await mkdir(runWorkspacePath, { recursive: true });
  return runWorkspacePath;
}
