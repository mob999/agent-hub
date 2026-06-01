import { randomUUID } from "node:crypto";

import type { RealtimeEvent } from "@agent-hub/core";

import type { AgentHubRedisClient } from "../queue/index.js";

export const realtimeChannel = "agenthub:realtime";

type RealtimeEventInput = {
  [Event in RealtimeEvent as Event["type"]]: Omit<
    Event,
    "createdAt" | "eventId"
  > & {
    createdAt?: string;
    eventId?: string;
  };
}[RealtimeEvent["type"]];

export function createRealtimeEvent(event: RealtimeEventInput): RealtimeEvent {
  return {
    ...event,
    createdAt: event.createdAt ?? new Date().toISOString(),
    eventId: event.eventId ?? randomUUID(),
  } as RealtimeEvent;
}

export async function publishRealtimeEvent(
  redis: AgentHubRedisClient,
  event: RealtimeEvent,
): Promise<void> {
  await redis.publish(realtimeChannel, JSON.stringify(event));
}

export async function subscribeRealtimeEvents(
  redis: AgentHubRedisClient,
  onEvent: (event: RealtimeEvent) => void,
): Promise<void> {
  await redis.subscribe(realtimeChannel, (message) => {
    onEvent(JSON.parse(message) as RealtimeEvent);
  });
}
