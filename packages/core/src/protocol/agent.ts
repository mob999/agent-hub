export type AgentId = string;
export type UserId = string;
export type DaemonDeviceId = string;
export type IsoDateTime = string;

export type RuntimeKind = "claude-code" | "codex" | "opencode" | "custom";

export type AgentStatus = "active" | "disabled" | "archived";

export type DaemonRuntimeStatus = "ready" | "unavailable" | "disabled";

export type RuntimeBindingStatus =
  | "pending"
  | "ready"
  | "unavailable"
  | "disabled";

export type AgentWorkspaceStatus =
  | "pending"
  | "ready"
  | "missing"
  | "unavailable";

export type AgentWorkspaceSyncMode = "local-only";

export interface RuntimeCapability {
  name: string;
  enabled: boolean;
  description?: string;
}

export interface Agent {
  id: AgentId;
  ownerUserId: UserId;
  name: string;
  description?: string;
  avatar?: string;
  defaultRuntimeKind: RuntimeKind;
  status: AgentStatus;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface DaemonDevice {
  id: DaemonDeviceId;
  ownerUserId: UserId;
  name: string;
  status: "online" | "offline" | "disabled";
  createdAt: IsoDateTime;
  lastSeenAt?: IsoDateTime;
}

export interface DaemonRuntime {
  daemonDeviceId: DaemonDeviceId;
  runtimeKind: RuntimeKind;
  runtimeVersion?: string;
  executablePath?: string;
  capabilities: RuntimeCapability[];
  status: DaemonRuntimeStatus;
  lastSeenAt?: IsoDateTime;
}

export interface AgentRuntimeBinding {
  agentId: AgentId;
  daemonDeviceId: DaemonDeviceId;
  runtimeKind: RuntimeKind;
  runtimeVersion?: string;
  executablePath?: string;
  capabilities: RuntimeCapability[];
  status: RuntimeBindingStatus;
  lastSeenAt?: IsoDateTime;
  error?: string;
}

export interface AgentWorkspace {
  agentId: AgentId;
  daemonDeviceId: DaemonDeviceId;
  workspacePath?: string;
  status: AgentWorkspaceStatus;
  syncMode: AgentWorkspaceSyncMode;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  error?: string;
}

export interface AgentWorkspaceManifest {
  schemaVersion: 1;
  agentId: AgentId;
  daemonDeviceId: DaemonDeviceId;
  syncMode: AgentWorkspaceSyncMode;
  createdAt: IsoDateTime;
}

export interface AgentRuntimeConfig {
  runtimeKind: RuntimeKind;
  runtimeVersion?: string;
  executablePath?: string;
  capabilities: RuntimeCapability[];
  updatedAt: IsoDateTime;
}

export interface AgentDetails {
  agent: Agent;
  runtimeBinding: AgentRuntimeBinding;
  workspace: AgentWorkspace;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  daemonDeviceId: DaemonDeviceId;
  runtimeKind: RuntimeKind;
}

export interface CreateAgentResponse {
  agent: AgentDetails;
}

export interface UpdateAgentRequest {
  name: string;
  description?: string;
}

export interface UpdateAgentResponse {
  agent: AgentDetails;
}

export const agentWorkspaceDirectoryNames = [
  ".agenthub",
  "memory",
  "skills",
  "files",
  "runs",
  "artifacts",
  "cache",
] as const;

export type AgentWorkspaceDirectoryName =
  (typeof agentWorkspaceDirectoryNames)[number];

export const agentWorkspaceMetadataDirectory = ".agenthub";
export const agentWorkspaceManifestFileName = "manifest.json";
export const agentWorkspaceRuntimeFileName = "runtime.json";
