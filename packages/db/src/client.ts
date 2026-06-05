import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema/index.js";

export interface CreateDbOptions {
  maxConnections?: number;
}

export function createDb(
  databaseUrl: string,
  options: CreateDbOptions = {},
) {
  const client = postgres(databaseUrl, {
    max: options.maxConnections ?? 3,
  });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;
