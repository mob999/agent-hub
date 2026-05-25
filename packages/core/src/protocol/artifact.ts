import type { AgentId, IsoDateTime } from "./agent.js";
import type { RunId } from "./run.js";

export type ArtifactId = string;

export type ArtifactKind =
  | "file"
  | "diff"
  | "web_preview"
  | "document"
  | "slide_deck"
  | "image"
  | "workflow_result"
  | "deployment";

export type ArtifactStatus = "pending" | "ready" | "failed" | "deleted";

export interface Artifact {
  id: ArtifactId;
  agentId: AgentId;
  runId?: RunId;
  kind: ArtifactKind;
  title: string;
  status: ArtifactStatus;
  payload: Record<string, unknown>;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}
