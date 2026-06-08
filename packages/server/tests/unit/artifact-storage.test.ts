import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getArtifactContentSize,
  readArtifactContent,
  writeArtifactBuffer,
} from "../../src";

const originalEnv = { ...process.env };

describe("artifact storage", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.AGENTHUB_STORAGE_DRIVER = "local";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("reads and writes artifact content with the local storage driver", async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), "agenthub-storage-"));

    try {
      const writtenBytes = await writeArtifactBuffer({
        content: Buffer.from("hello", "utf8"),
        storageKey: "conversations/conversation-1/artifacts/artifact-1/index.html",
        storageRoot,
      });

      await expect(readArtifactContent({
        storageKey: "conversations/conversation-1/artifacts/artifact-1/index.html",
        storageRoot,
      })).resolves.toEqual(Buffer.from("hello", "utf8"));
      await expect(getArtifactContentSize({
        storageKey: "conversations/conversation-1/artifacts/artifact-1/index.html",
        storageRoot,
      })).resolves.toBe(5);
      expect(writtenBytes).toBe(5);
    } finally {
      await rm(storageRoot, { force: true, recursive: true });
    }
  });

  it("rejects local storage keys that escape the storage root", async () => {
    const storageRoot = await mkdtemp(path.join(tmpdir(), "agenthub-storage-"));

    try {
      await expect(writeArtifactBuffer({
        content: Buffer.from("escape", "utf8"),
        storageKey: "../escape.txt",
        storageRoot,
      })).rejects.toThrow("Artifact storage key escapes storage root.");
    } finally {
      await rm(storageRoot, { force: true, recursive: true });
    }
  });

  it("uses the configured S3-compatible storage client", async () => {
    process.env.AGENTHUB_STORAGE_DRIVER = "s3";
    process.env.AGENTHUB_S3_ENDPOINT = "https://project-ref.supabase.co/storage/v1/s3";
    process.env.AGENTHUB_S3_REGION = "ap-southeast-2";
    process.env.AGENTHUB_S3_ACCESS_KEY_ID = "access-key";
    process.env.AGENTHUB_S3_SECRET_ACCESS_KEY = "secret-key";
    process.env.AGENTHUB_S3_BUCKET = "tavro-artifacts";
    const send = vi.spyOn(S3Client.prototype, "send").mockImplementation(
      async (command: unknown) => {
        if (command instanceof PutObjectCommand) {
          expect(command.input).toMatchObject({
            Bucket: "tavro-artifacts",
            Key: "deployments/conversation-1/deployment-1/files/index.html",
          });
          return {};
        }

        if (command instanceof GetObjectCommand) {
          expect(command.input).toMatchObject({
            Bucket: "tavro-artifacts",
            Key: "deployments/conversation-1/deployment-1/files/index.html",
          });
          return {
            Body: {
              transformToByteArray: async () => new TextEncoder().encode("hello"),
            },
          };
        }

        if (command instanceof HeadObjectCommand) {
          expect(command.input).toMatchObject({
            Bucket: "tavro-artifacts",
            Key: "deployments/conversation-1/deployment-1/files/index.html",
          });
          return { ContentLength: 5 };
        }

        throw new Error("Unexpected S3 command.");
      },
    );

    await expect(writeArtifactBuffer({
      content: Buffer.from("hello", "utf8"),
      storageKey: "deployments/conversation-1/deployment-1/files/index.html",
      storageRoot: "/unused",
    })).resolves.toBe(5);
    await expect(readArtifactContent({
      storageKey: "deployments/conversation-1/deployment-1/files/index.html",
      storageRoot: "/unused",
    })).resolves.toEqual(Buffer.from("hello", "utf8"));
    await expect(getArtifactContentSize({
      storageKey: "deployments/conversation-1/deployment-1/files/index.html",
      storageRoot: "/unused",
    })).resolves.toBe(5);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it("maps S3 missing objects to ENOENT-compatible errors", async () => {
    process.env.AGENTHUB_STORAGE_DRIVER = "s3";
    process.env.AGENTHUB_S3_ENDPOINT = "https://project-ref.supabase.co/storage/v1/s3";
    process.env.AGENTHUB_S3_REGION = "ap-southeast-2";
    process.env.AGENTHUB_S3_ACCESS_KEY_ID = "access-key";
    process.env.AGENTHUB_S3_SECRET_ACCESS_KEY = "secret-key";
    process.env.AGENTHUB_S3_BUCKET = "tavro-artifacts";
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue({
      $metadata: { httpStatusCode: 404 },
      name: "NoSuchKey",
    });

    await expect(readArtifactContent({
      storageKey: "missing/index.html",
      storageRoot: "/unused",
    })).rejects.toMatchObject({ code: "ENOENT" });
  });
});
