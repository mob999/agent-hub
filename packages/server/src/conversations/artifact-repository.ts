import { createHash, randomUUID } from "node:crypto";

import type {
  ConversationArtifact,
  ConversationArtifactAction,
  ConversationArtifactActionType,
  ConversationArtifactDetails,
  ConversationArtifactFile,
  ConversationArtifactFileRevision,
  ConversationArtifactRevision,
  ConversationDeployment,
  ConversationId,
} from "@agent-hub/core";
import { inferArtifactFileInfo } from "@agent-hub/core";
import {
  conversationArtifactActions,
  conversationArtifactFiles,
  conversationArtifactFileRevisions,
  conversationArtifactRevisions,
  conversationArtifacts,
  conversationDeployments,
  conversationGoals,
  conversationGoalTasks,
  conversations,
  runs,
  type Db,
} from "@agent-hub/db";
import { and, asc, desc, eq } from "drizzle-orm";

import {
  conversationArtifactRevisionStorageKey,
  conversationArtifactSiteFileRevisionStorageKey,
  conversationDeploymentFileStorageKey,
  conversationDeploymentStoragePrefix,
  createStoredZip,
  readArtifactContent,
  sanitizeArtifactFilename,
  writeArtifactBuffer,
  writeArtifactTextContent,
} from "../artifacts/index.js";
import type { ArtifactActionQueueJob } from "../queue/index.js";
import type { MemoryAppendQueueJob } from "../queue/index.js";
import {
  optionalString,
  toConversationArtifact,
  toConversationArtifactAction,
  toConversationArtifactFile,
  toConversationArtifactFileRevision,
  toConversationArtifactRevision,
  toConversationDeployment,
  type ConversationArtifactRow,
} from "./mappers.js";
import type {
  CreateConversationArtifactActionInput,
  CreateConversationArtifactFileRevisionInput,
  CreateConversationArtifactRevisionInput,
  PersistStaticSiteDeploymentInput,
} from "./types.js";

async function hasActiveConversationForUser(
  db: Db,
  input: { conversationId: ConversationId; ownerUserId: string },
): Promise<boolean> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(
        eq(conversations.id, input.conversationId),
        eq(conversations.ownerUserId, input.ownerUserId),
        eq(conversations.status, "active"),
      ),
    )
    .limit(1);

  return conversation !== undefined;
}

export async function listConversationArtifactsForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<ConversationArtifact[] | null> {
  if (!(await hasActiveConversationForUser(db, input))) {
    return null;
  }

  const rows = await db
    .select()
    .from(conversationArtifacts)
    .where(eq(conversationArtifacts.conversationId, input.conversationId))
    .orderBy(desc(conversationArtifacts.createdAt));

  return rows.map((row) =>
    toConversationArtifact(row, {
      publicApiBaseUrl: input.publicApiBaseUrl,
      publicWebBaseUrl: input.publicWebBaseUrl,
    }),
  );
}

export async function listConversationDeploymentsForUser(
  db: Db,
  input: {
    conversationId: ConversationId;
    ownerUserId: string;
    publicApiBaseUrl?: string;
  },
): Promise<ConversationDeployment[] | null> {
  if (!(await hasActiveConversationForUser(db, input))) {
    return null;
  }

  const rows = await db
    .select()
    .from(conversationDeployments)
    .where(eq(conversationDeployments.conversationId, input.conversationId))
    .orderBy(desc(conversationDeployments.createdAt));

  return rows.map((row) =>
    toConversationDeployment(row, {
      publicApiBaseUrl: input.publicApiBaseUrl,
    }),
  );
}

export async function getConversationArtifactForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<
  | { artifact: ConversationArtifact; storageKey: string; sourcePath: string | null }
  | null
> {
  const [row] = await db
    .select()
    .from(conversationArtifacts)
    .where(
      and(
        eq(conversationArtifacts.id, input.artifactId),
        eq(conversationArtifacts.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  if (row === undefined) {
    return null;
  }

  return {
    artifact: toConversationArtifact(row, {
      publicApiBaseUrl: input.publicApiBaseUrl,
      publicWebBaseUrl: input.publicWebBaseUrl,
    }),
    storageKey: row.storageKey,
    sourcePath: row.sourcePath,
  };
}

function availableArtifactActions(
  artifact: ConversationArtifact,
): ConversationArtifactActionType[] {
  if (artifact.status !== "ready" || artifact.creatorType === "user") {
    return [];
  }

  if (artifact.kind === "site") {
    return ["publish"];
  }

  const fileInfo = inferArtifactFileInfo({ filename: artifact.filename });
  const actions: ConversationArtifactActionType[] = [];

  if (fileInfo.canApply) {
    actions.push("apply");
  }

  if (fileInfo.canPreview) {
    actions.push("preview");
  }

  return actions;
}

export async function getConversationArtifactDetailsForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    publicWebBaseUrl?: string;
  },
): Promise<ConversationArtifactDetails | null> {
  const record = await getConversationArtifactForUser(db, input);

  if (record === null) {
    return null;
  }

  const [latestRevision] = record.artifact.latestRevisionId === undefined
    ? []
    : await db
        .select()
        .from(conversationArtifactRevisions)
        .where(eq(conversationArtifactRevisions.id, record.artifact.latestRevisionId))
        .limit(1);
  const actionRows = await db
    .select()
    .from(conversationArtifactActions)
    .where(eq(conversationArtifactActions.artifactId, input.artifactId))
    .orderBy(desc(conversationArtifactActions.createdAt));
  const fileRows = record.artifact.kind === "site"
    ? await db
        .select()
        .from(conversationArtifactFiles)
        .where(eq(conversationArtifactFiles.artifactId, input.artifactId))
        .orderBy(asc(conversationArtifactFiles.path))
    : [];

  return {
    artifact: record.artifact,
    latestRevision:
      latestRevision === undefined
        ? undefined
        : toConversationArtifactRevision(latestRevision),
    files: fileRows.map(toConversationArtifactFile),
    actions: actionRows.map(toConversationArtifactAction),
    availableActions: availableArtifactActions(record.artifact),
  };
}

export async function listConversationArtifactFilesForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
  },
): Promise<ConversationArtifactFile[] | null> {
  const [artifact] = await db
    .select({ id: conversationArtifacts.id, kind: conversationArtifacts.kind })
    .from(conversationArtifacts)
    .where(
      and(
        eq(conversationArtifacts.id, input.artifactId),
        eq(conversationArtifacts.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  if (artifact === undefined || artifact.kind !== "site") {
    return null;
  }

  const rows = await db
    .select()
    .from(conversationArtifactFiles)
    .where(eq(conversationArtifactFiles.artifactId, input.artifactId))
    .orderBy(asc(conversationArtifactFiles.path));

  return rows.map(toConversationArtifactFile);
}

export async function getConversationArtifactContentForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    revisionId?: string;
    storageRoot: string;
  },
): Promise<
  | { content: string; revision?: ConversationArtifactRevision }
  | null
> {
  const record = await getConversationArtifactForUser(db, input);

  if (record === null) {
    return null;
  }

  if (input.revisionId !== undefined) {
    const [revisionRow] = await db
      .select()
      .from(conversationArtifactRevisions)
      .where(
        and(
          eq(conversationArtifactRevisions.id, input.revisionId),
          eq(conversationArtifactRevisions.artifactId, input.artifactId),
          eq(conversationArtifactRevisions.ownerUserId, input.ownerUserId),
        ),
      )
      .limit(1);

    if (revisionRow === undefined) {
      return null;
    }

    const content = await readArtifactContent({
      storageKey: revisionRow.storageKey,
      storageRoot: input.storageRoot,
    });

    return {
      content: content.toString("utf8"),
      revision: toConversationArtifactRevision(revisionRow),
    };
  }

  const content = await readArtifactContent({
    storageKey: record.storageKey,
    storageRoot: input.storageRoot,
  });

  return { content: content.toString("utf8") };
}

function normalizeSiteArtifactPath(filePath: string): string {
  const normalized = filePath.split(/[\\/]+/).filter(Boolean).join("/");

  if (
    normalized.length === 0 ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    throw new Error("Artifact file path is invalid.");
  }

  return normalized;
}

export async function getConversationArtifactFileContentForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    path: string;
    storageRoot: string;
  },
): Promise<{
  content: string;
  file: ConversationArtifactFile;
  revision?: ConversationArtifactFileRevision;
} | null> {
  const normalizedPath = normalizeSiteArtifactPath(input.path);
  const [row] = await db
    .select({
      artifact: conversationArtifacts,
      file: conversationArtifactFiles,
      revision: conversationArtifactFileRevisions,
    })
    .from(conversationArtifactFiles)
    .innerJoin(
      conversationArtifacts,
      eq(conversationArtifactFiles.artifactId, conversationArtifacts.id),
    )
    .leftJoin(
      conversationArtifactFileRevisions,
      eq(conversationArtifactFiles.latestRevisionId, conversationArtifactFileRevisions.id),
    )
    .where(
      and(
        eq(conversationArtifactFiles.artifactId, input.artifactId),
        eq(conversationArtifactFiles.ownerUserId, input.ownerUserId),
        eq(conversationArtifactFiles.path, normalizedPath),
        eq(conversationArtifacts.kind, "site"),
      ),
    )
    .limit(1);

  if (row === undefined) {
    return null;
  }

  const content = await readArtifactContent({
    storageKey: row.revision?.storageKey ?? row.file.storageKey,
    storageRoot: input.storageRoot,
  });

  return {
    content: content.toString("utf8"),
    file: toConversationArtifactFile(row.file),
    revision: row.revision === null
      ? undefined
      : toConversationArtifactFileRevision(row.revision),
  };
}

export async function getConversationArtifactFileRawContentForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    path: string;
    storageRoot: string;
  },
): Promise<{
  content: Buffer;
  file: ConversationArtifactFile;
  revision?: ConversationArtifactFileRevision;
} | null> {
  const normalizedPath = normalizeSiteArtifactPath(input.path);
  const [row] = await db
    .select({
      artifact: conversationArtifacts,
      file: conversationArtifactFiles,
      revision: conversationArtifactFileRevisions,
    })
    .from(conversationArtifactFiles)
    .innerJoin(
      conversationArtifacts,
      eq(conversationArtifactFiles.artifactId, conversationArtifacts.id),
    )
    .leftJoin(
      conversationArtifactFileRevisions,
      eq(conversationArtifactFiles.latestRevisionId, conversationArtifactFileRevisions.id),
    )
    .where(
      and(
        eq(conversationArtifactFiles.artifactId, input.artifactId),
        eq(conversationArtifactFiles.ownerUserId, input.ownerUserId),
        eq(conversationArtifactFiles.path, normalizedPath),
        eq(conversationArtifacts.kind, "site"),
      ),
    )
    .limit(1);

  if (row === undefined) {
    return null;
  }

  const content = await readArtifactContent({
    storageKey: row.revision?.storageKey ?? row.file.storageKey,
    storageRoot: input.storageRoot,
  });

  return {
    content,
    file: toConversationArtifactFile(row.file),
    revision: row.revision === null
      ? undefined
      : toConversationArtifactFileRevision(row.revision),
  };
}

export async function getSiteArtifactZipForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    storageRoot: string;
  },
): Promise<{ content: Buffer; filename: string } | null> {
  const [artifact] = await db
    .select()
    .from(conversationArtifacts)
    .where(
      and(
        eq(conversationArtifacts.id, input.artifactId),
        eq(conversationArtifacts.ownerUserId, input.ownerUserId),
        eq(conversationArtifacts.kind, "site"),
      ),
    )
    .limit(1);

  if (artifact === undefined) {
    return null;
  }

  const fileRows = await db
    .select({
      file: conversationArtifactFiles,
      revision: conversationArtifactFileRevisions,
    })
    .from(conversationArtifactFiles)
    .leftJoin(
      conversationArtifactFileRevisions,
      eq(conversationArtifactFiles.latestRevisionId, conversationArtifactFileRevisions.id),
    )
    .where(eq(conversationArtifactFiles.artifactId, input.artifactId))
    .orderBy(asc(conversationArtifactFiles.path));

  const files = [];
  for (const row of fileRows) {
    files.push({
      path: row.file.path,
      content: await readArtifactContent({
        storageKey: row.revision?.storageKey ?? row.file.storageKey,
        storageRoot: input.storageRoot,
      }),
    });
  }

  return {
    content: createStoredZip(files),
    filename: `${sanitizeArtifactFilename(artifact.filename)}.zip`,
  };
}

export async function getDownloadableArtifactContentForRun(
  db: Db,
  input: {
    artifactId: string;
    conversationId: string;
    goalId?: string;
    ownerUserId: string;
    storageRoot: string;
  },
): Promise<{ artifact: ConversationArtifactRow; content: Buffer; filename: string } | null> {
  const [artifact] = await db
    .select()
    .from(conversationArtifacts)
    .where(
      and(
        eq(conversationArtifacts.id, input.artifactId),
        eq(conversationArtifacts.ownerUserId, input.ownerUserId),
        eq(conversationArtifacts.conversationId, input.conversationId),
        ...(input.goalId === undefined
          ? []
          : [eq(conversationArtifacts.goalId, input.goalId)]),
      ),
    )
    .limit(1);

  if (artifact === undefined) {
    return null;
  }

  if (artifact.kind === "site") {
    const fileRows = await db
      .select({
        file: conversationArtifactFiles,
        revision: conversationArtifactFileRevisions,
      })
      .from(conversationArtifactFiles)
      .leftJoin(
        conversationArtifactFileRevisions,
        eq(conversationArtifactFiles.latestRevisionId, conversationArtifactFileRevisions.id),
      )
      .where(eq(conversationArtifactFiles.artifactId, artifact.id))
      .orderBy(asc(conversationArtifactFiles.path));

    if (fileRows.length === 0) {
      return null;
    }

    const files = [];
    for (const row of fileRows) {
      files.push({
        path: row.file.path,
        content: await readArtifactContent({
          storageKey: row.revision?.storageKey ?? row.file.storageKey,
          storageRoot: input.storageRoot,
        }),
      });
    }

    return {
      artifact,
      content: createStoredZip(files),
      filename: `${sanitizeArtifactFilename(artifact.filename)}.zip`,
    };
  }

  let storageKey = artifact.storageKey;
  if (artifact.latestRevisionId !== null) {
    const [revision] = await db
      .select({ storageKey: conversationArtifactRevisions.storageKey })
      .from(conversationArtifactRevisions)
      .where(
        and(
          eq(conversationArtifactRevisions.id, artifact.latestRevisionId),
          eq(conversationArtifactRevisions.artifactId, artifact.id),
          eq(conversationArtifactRevisions.ownerUserId, artifact.ownerUserId),
        ),
      )
      .limit(1);

    storageKey = revision?.storageKey ?? storageKey;
  }

  return {
    artifact,
    content: await readArtifactContent({
      storageKey,
      storageRoot: input.storageRoot,
    }),
    filename: artifact.filename,
  };
}

export async function createConversationArtifactRevision(
  db: Db,
  input: CreateConversationArtifactRevisionInput,
): Promise<ConversationArtifactRevision | null> {
  const record = await getConversationArtifactForUser(db, {
    artifactId: input.artifactId,
    ownerUserId: input.ownerUserId,
  });

  if (record === null) {
    return null;
  }

  const revisionId = randomUUID();
  const contentHash = createHash("sha256").update(input.content).digest("hex");
  const storageKey = conversationArtifactRevisionStorageKey({
    artifactId: input.artifactId,
    conversationId: record.artifact.conversationId,
    filename: record.artifact.filename,
    revisionId,
  });
  await writeArtifactTextContent({
    content: input.content,
    storageKey,
    storageRoot: input.storageRoot,
  });

  const now = new Date();
  const [revision] = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversationArtifactRevisions)
      .values({
        id: revisionId,
        artifactId: input.artifactId,
        ownerUserId: input.ownerUserId,
        conversationId: record.artifact.conversationId,
        runId: record.artifact.runId,
        editorUserId: input.editorUserId,
        storageKey,
        contentHash,
        summary: input.summary,
        createdAt: now,
      })
      .returning();

    await tx
      .update(conversationArtifacts)
      .set({
        latestRevisionId: revisionId,
        updatedAt: now,
      })
      .where(eq(conversationArtifacts.id, input.artifactId));

    return [created];
  });

  return revision === undefined ? null : toConversationArtifactRevision(revision);
}

export async function createConversationArtifactFileRevision(
  db: Db,
  input: CreateConversationArtifactFileRevisionInput,
): Promise<ConversationArtifactFileRevision | null> {
  const normalizedPath = normalizeSiteArtifactPath(input.path);
  const [record] = await db
    .select({
      artifact: conversationArtifacts,
      file: conversationArtifactFiles,
    })
    .from(conversationArtifactFiles)
    .innerJoin(
      conversationArtifacts,
      eq(conversationArtifactFiles.artifactId, conversationArtifacts.id),
    )
    .where(
      and(
        eq(conversationArtifactFiles.artifactId, input.artifactId),
        eq(conversationArtifactFiles.ownerUserId, input.ownerUserId),
        eq(conversationArtifactFiles.path, normalizedPath),
        eq(conversationArtifacts.kind, "site"),
      ),
    )
    .limit(1);

  if (record === undefined) {
    return null;
  }

  const revisionId = randomUUID();
  const storageKey = conversationArtifactSiteFileRevisionStorageKey({
    artifactId: input.artifactId,
    conversationId: record.file.conversationId,
    filePath: normalizedPath,
    revisionId,
  });
  const writtenBytes = await writeArtifactTextContent({
    content: input.content,
    storageKey,
    storageRoot: input.storageRoot,
  });
  const now = new Date();
  const contentHash = createHash("sha256").update(input.content).digest("hex");

  const revision = await db.transaction(async (tx) => {
    const [revisionRow] = await tx
      .insert(conversationArtifactFileRevisions)
      .values({
        id: revisionId,
        artifactFileId: record.file.id,
        artifactId: input.artifactId,
        ownerUserId: input.ownerUserId,
        conversationId: record.file.conversationId,
        path: normalizedPath,
        editorUserId: input.editorUserId,
        storageKey,
        contentHash,
        summary: input.summary,
        createdAt: now,
      })
      .returning();

    if (revisionRow === undefined) {
      return undefined;
    }

    await tx
      .update(conversationArtifactFiles)
      .set({
        latestRevisionId: revisionId,
        sizeBytes: writtenBytes,
        updatedAt: now,
      })
      .where(eq(conversationArtifactFiles.id, record.file.id));

    await tx
      .update(conversationArtifacts)
      .set({ updatedAt: now })
      .where(eq(conversationArtifacts.id, input.artifactId));

    return revisionRow;
  });

  return revision === undefined
    ? null
    : toConversationArtifactFileRevision(revision);
}

export async function createConversationArtifactAction(
  db: Db,
  input: CreateConversationArtifactActionInput,
): Promise<
  | { action: ConversationArtifactAction; job: ArtifactActionQueueJob }
  | null
> {
  const record = await getConversationArtifactForUser(db, {
    artifactId: input.artifactId,
    ownerUserId: input.ownerUserId,
  });

  if (record === null) {
    return null;
  }

  if (record.artifact.runId === undefined) {
    return null;
  }

  const [run] = await db
    .select({
      daemonDeviceId: runs.daemonDeviceId,
      workspacePath: runs.workspacePath,
    })
    .from(runs)
    .where(eq(runs.id, record.artifact.runId))
    .limit(1);

  if (run === undefined) {
    return null;
  }

  let revisionId = input.revisionId ?? record.artifact.latestRevisionId;

  if (revisionId !== undefined) {
    const [revision] = await db
      .select({ id: conversationArtifactRevisions.id })
      .from(conversationArtifactRevisions)
      .where(
        and(
          eq(conversationArtifactRevisions.id, revisionId),
          eq(conversationArtifactRevisions.artifactId, input.artifactId),
          eq(conversationArtifactRevisions.ownerUserId, input.ownerUserId),
        ),
      )
      .limit(1);

    if (revision === undefined) {
      return null;
    }
  } else if (input.type !== "preview" && input.type !== "publish") {
    revisionId = undefined;
  }

  const now = new Date();
  const [actionRow] = await db
    .insert(conversationArtifactActions)
    .values({
      artifactId: input.artifactId,
      revisionId,
      ownerUserId: input.ownerUserId,
      conversationId: record.artifact.conversationId,
      type: input.type,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (actionRow === undefined) {
    return null;
  }

  return {
    action: toConversationArtifactAction(actionRow),
    job: {
      actionId: actionRow.id,
      artifactId: input.artifactId,
      actionType: input.type,
      daemonDeviceId: run.daemonDeviceId,
      revisionId,
      workspacePath: run.workspacePath,
    },
  };
}

export async function publishSiteArtifactForUser(
  db: Db,
  input: {
    artifactId: string;
    ownerUserId: string;
    publicApiBaseUrl?: string;
    storageRoot: string;
    userId: string;
  },
): Promise<{
  action: ConversationArtifactAction;
  deployment?: ConversationDeployment;
} | null> {
  const [record] = await db
    .select({
      artifact: conversationArtifacts,
      run: runs,
    })
    .from(conversationArtifacts)
    .innerJoin(runs, eq(conversationArtifacts.runId, runs.id))
    .where(
      and(
        eq(conversationArtifacts.id, input.artifactId),
        eq(conversationArtifacts.ownerUserId, input.ownerUserId),
        eq(conversationArtifacts.kind, "site"),
      ),
    )
    .limit(1);

  if (
    record === undefined ||
    record.artifact.entrypoint === null ||
    record.artifact.runId === null ||
    record.artifact.creatorAgentId === null
  ) {
    return null;
  }

  const now = new Date();
  const [queuedAction] = await db
    .insert(conversationArtifactActions)
    .values({
      artifactId: input.artifactId,
      ownerUserId: input.ownerUserId,
      conversationId: record.artifact.conversationId,
      type: "publish",
      status: "running",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (queuedAction === undefined) {
    return null;
  }

  try {
    const fileRows = await db
      .select({
        file: conversationArtifactFiles,
        revision: conversationArtifactFileRevisions,
      })
      .from(conversationArtifactFiles)
      .leftJoin(
        conversationArtifactFileRevisions,
        eq(conversationArtifactFiles.latestRevisionId, conversationArtifactFileRevisions.id),
      )
      .where(eq(conversationArtifactFiles.artifactId, input.artifactId))
      .orderBy(asc(conversationArtifactFiles.path));

    if (fileRows.length === 0) {
      throw new Error("Site artifact has no files to publish.");
    }

    const deploymentId = randomUUID();
    const storagePrefix = conversationDeploymentStoragePrefix({
      conversationId: record.artifact.conversationId,
      deploymentId,
    });

    for (const row of fileRows) {
      const content = await readArtifactContent({
        storageKey: row.revision?.storageKey ?? row.file.storageKey,
        storageRoot: input.storageRoot,
      });
      await writeArtifactBuffer({
        content,
        storageKey: conversationDeploymentFileStorageKey({
          storagePrefix,
          filePath: row.file.path,
        }),
        storageRoot: input.storageRoot,
      });
    }

    const [deploymentRow] = await db
      .insert(conversationDeployments)
      .values({
        id: deploymentId,
        ownerUserId: record.artifact.ownerUserId,
        conversationId: record.artifact.conversationId,
        goalId: record.artifact.goalId,
        taskIndex: record.artifact.taskIndex,
        runId: record.artifact.runId,
        creatorAgentId: record.artifact.creatorAgentId,
        sourceArtifactId: record.artifact.id,
        publishedByUserId: input.userId,
        publishedFrom: "user",
        title: record.artifact.title,
        entrypoint: record.artifact.entrypoint,
        status: "ready",
        storagePrefix,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (deploymentRow === undefined) {
      throw new Error("Deployment could not be created.");
    }

    const deployment = toConversationDeployment(deploymentRow, {
      publicApiBaseUrl: input.publicApiBaseUrl,
    });
    const [actionRow] = await db
      .update(conversationArtifactActions)
      .set({
        status: "succeeded",
        result: {
          deploymentId: deployment.id,
          url: deployment.url,
        },
        updatedAt: new Date(),
      })
      .where(eq(conversationArtifactActions.id, queuedAction.id))
      .returning();

    return {
      action: toConversationArtifactAction(actionRow ?? queuedAction),
      deployment,
    };
  } catch (error) {
    const [actionRow] = await db
      .update(conversationArtifactActions)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        updatedAt: new Date(),
      })
      .where(eq(conversationArtifactActions.id, queuedAction.id))
      .returning();

    return {
      action: toConversationArtifactAction(actionRow ?? queuedAction),
    };
  }
}

export async function getArtifactActionAssignment(
  db: Db,
  input: { actionId: string; storageRoot: string },
): Promise<
  | {
      actionId: string;
      actionType: ConversationArtifactActionType;
      artifactId: string;
      contentBase64: string;
      daemonDeviceId: string;
      filename: string;
      sourcePath?: string;
      workspacePath: string;
    }
  | null
> {
  const [row] = await db
    .select({
      action: conversationArtifactActions,
      artifact: conversationArtifacts,
      revision: conversationArtifactRevisions,
      run: runs,
    })
    .from(conversationArtifactActions)
    .innerJoin(
      conversationArtifacts,
      eq(conversationArtifactActions.artifactId, conversationArtifacts.id),
    )
    .innerJoin(runs, eq(conversationArtifacts.runId, runs.id))
    .leftJoin(
      conversationArtifactRevisions,
      eq(conversationArtifactActions.revisionId, conversationArtifactRevisions.id),
    )
    .where(eq(conversationArtifactActions.id, input.actionId))
    .limit(1);

  if (row === undefined) {
    return null;
  }

  const storageKey = row.revision?.storageKey ?? row.artifact.storageKey;
  const content = await readArtifactContent({
    storageKey,
    storageRoot: input.storageRoot,
  });

  return {
    actionId: row.action.id,
    actionType: row.action.type as ConversationArtifactActionType,
    artifactId: row.artifact.id,
    contentBase64: content.toString("base64"),
    daemonDeviceId: row.run.daemonDeviceId,
    filename: row.artifact.filename,
    sourcePath: optionalString(row.artifact.sourcePath),
    workspacePath: row.run.workspacePath,
  };
}

export async function markConversationArtifactActionRunning(
  db: Db,
  input: { actionId: string },
): Promise<{
  action: ConversationArtifactAction;
  conversationId: string;
  ownerUserId: string;
} | null> {
  const [action] = await db
    .update(conversationArtifactActions)
    .set({
      status: "running",
      updatedAt: new Date(),
    })
    .where(eq(conversationArtifactActions.id, input.actionId))
    .returning();

  return action === undefined
    ? null
    : {
        action: toConversationArtifactAction(action),
        conversationId: action.conversationId,
        ownerUserId: action.ownerUserId,
      };
}

export async function completeConversationArtifactAction(
  db: Db,
  input: {
    actionId: string;
    error?: string;
    result?: Record<string, unknown>;
    status: "succeeded" | "failed" | "cancelled";
  },
): Promise<{
  action: ConversationArtifactAction;
  conversationId: string;
  ownerUserId: string;
} | null> {
  const [action] = await db
    .update(conversationArtifactActions)
    .set({
      status: input.status,
      error: input.error,
      result: input.result,
      updatedAt: new Date(),
    })
    .where(eq(conversationArtifactActions.id, input.actionId))
    .returning();

  return action === undefined
    ? null
    : {
        action: toConversationArtifactAction(action),
        conversationId: action.conversationId,
        ownerUserId: action.ownerUserId,
      };
}

function normalizeDeploymentFilePath(filePath: string): string {
  const normalized = filePath.split(/[\\/]+/).filter(Boolean).join("/");

  if (
    normalized.length === 0 ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    normalized === ".."
  ) {
    throw new Error("Deployment file path is invalid.");
  }

  return normalized;
}

export async function persistStaticSiteDeployment(
  db: Db,
  input: PersistStaticSiteDeploymentInput,
): Promise<ConversationDeployment> {
  const [run] = await db
    .select({
      agentId: runs.agentId,
      conversationId: runs.conversationId,
      ownerUserId: runs.ownerUserId,
    })
    .from(runs)
    .where(eq(runs.id, input.runId))
    .limit(1);

  if (run === undefined || run.conversationId === null) {
    throw new Error("Static site deployment run was not found.");
  }

  let goalTaskId: string | undefined;
  if (input.goalId !== undefined) {
    if (input.taskIndex === undefined) {
      throw new Error("Deployment task index is required for goal deployments.");
    }

    const [task] = await db
      .select({
        id: conversationGoalTasks.id,
      })
      .from(conversationGoalTasks)
      .innerJoin(conversationGoals, eq(conversationGoalTasks.goalId, conversationGoals.id))
      .where(
        and(
          eq(conversationGoals.id, input.goalId),
          eq(conversationGoals.conversationId, run.conversationId),
          eq(conversationGoalTasks.index, input.taskIndex),
          eq(conversationGoalTasks.assigneeRunId, input.runId),
          eq(conversationGoalTasks.assigneeAgentId, run.agentId),
        ),
      )
      .limit(1);

    if (task === undefined) {
      throw new Error("Deployment goal task does not belong to this run.");
    }
    goalTaskId = task.id;
  }

  const normalizedEntrypoint = normalizeDeploymentFilePath(input.entrypoint);
  const deploymentFiles = input.files.map((file) => ({
    ...file,
    path: normalizeDeploymentFilePath(file.path),
  }));
  const entrypointFile = deploymentFiles.find(
    (file) => file.path === normalizedEntrypoint,
  );

  if (entrypointFile === undefined) {
    throw new Error("Static site entrypoint was not included in deployment.");
  }

  const deploymentId = randomUUID();
  const storagePrefix = conversationDeploymentStoragePrefix({
    conversationId: run.conversationId,
    deploymentId,
  });

  for (const file of deploymentFiles) {
    const content = Buffer.from(file.contentBase64, "base64");
    if (content.byteLength !== file.sizeBytes) {
      throw new Error(`Deployment file size did not match: ${file.path}`);
    }

    await writeArtifactBuffer({
      content,
      storageKey: conversationDeploymentFileStorageKey({
        storagePrefix,
        filePath: file.path,
      }),
      storageRoot: input.storageRoot,
    });
  }

  const now = new Date();
  const [deployment] = await db
    .insert(conversationDeployments)
    .values({
      id: deploymentId,
      ownerUserId: run.ownerUserId,
      conversationId: run.conversationId,
      goalId: input.goalId,
      taskIndex: input.taskIndex,
      runId: input.runId,
      creatorAgentId: run.agentId,
      title: input.title.trim(),
      entrypoint: normalizedEntrypoint,
      status: "ready",
      storagePrefix,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (deployment === undefined) {
    throw new Error("Static site deployment could not be persisted.");
  }

  void goalTaskId;

  return toConversationDeployment(deployment, {
    publicApiBaseUrl: input.publicApiBaseUrl,
  });
}

export async function getConversationDeploymentFileForUser(
  db: Db,
  input: {
    deploymentId: string;
    ownerUserId: string;
    requestedPath?: string;
    storageRoot: string;
    publicApiBaseUrl?: string;
  },
): Promise<
  | {
      content: Buffer;
      deployment: ConversationDeployment;
      filename: string;
    }
  | null
> {
  const [row] = await db
    .select()
    .from(conversationDeployments)
    .where(
      and(
        eq(conversationDeployments.id, input.deploymentId),
        eq(conversationDeployments.ownerUserId, input.ownerUserId),
      ),
    )
    .limit(1);

  if (row === undefined || row.status !== "ready") {
    return null;
  }

  const requestedPath = input.requestedPath?.trim();
  const filePath =
    requestedPath === undefined || requestedPath.length === 0
      ? row.entrypoint
      : normalizeDeploymentFilePath(requestedPath);
  const content = await readArtifactContent({
    storageKey: conversationDeploymentFileStorageKey({
      storagePrefix: row.storagePrefix,
      filePath,
    }),
    storageRoot: input.storageRoot,
  });

  return {
    content,
    deployment: toConversationDeployment(row, {
      publicApiBaseUrl: input.publicApiBaseUrl,
    }),
    filename: filePath,
  };
}

export async function createArtifactActionMemoryAppendJobs(
  db: Db,
  input: {
    action: ConversationArtifactAction;
    createdAt?: string;
  },
): Promise<MemoryAppendQueueJob[]> {
  if (input.action.status !== "succeeded") {
    return [];
  }

  const [row] = await db
    .select({
      artifact: conversationArtifacts,
      run: runs,
    })
    .from(conversationArtifacts)
    .innerJoin(runs, eq(conversationArtifacts.runId, runs.id))
    .where(eq(conversationArtifacts.id, input.action.artifactId))
    .limit(1);

  if (row === undefined) {
    return [];
  }

  const createdAt = input.createdAt ?? input.action.updatedAt;

  return [
    {
      agentId: row.run.agentId,
      daemonDeviceId: row.run.daemonDeviceId,
      workspacePath: row.run.workspacePath,
      kind: "daily",
      title: "Artifact action completed",
      tags: ["artifact", "action", input.action.type],
      date: createdAt.slice(0, 10),
      dedupeKey: `artifact-action:${input.action.id}:${input.action.status}`,
      createdAt,
      content: [
        `Completed artifact action: ${input.action.type}`,
        `Action: ${input.action.id}`,
        `Artifact: ${row.artifact.title} (${row.artifact.id})`,
        `Conversation: ${row.artifact.conversationId}`,
        row.artifact.goalId === null ? undefined : `Goal: ${row.artifact.goalId}`,
        row.artifact.taskIndex === null ? undefined : `Task index: ${row.artifact.taskIndex}`,
      ].filter((line): line is string => line !== undefined).join("\n"),
    },
  ];
}
