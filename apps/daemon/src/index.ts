import { isDirectDaemonEntry, startDaemon } from "./client";

export * from "./client";
export * from "./runtime";
export * from "./workspace";

if (isDirectDaemonEntry(import.meta.url)) {
  await startDaemon();
}
