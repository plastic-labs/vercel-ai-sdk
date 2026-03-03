import type { Honcho } from "@honcho-ai/sdk";
import { createClient } from "../shared/context.js";
import type { HonchoProviderOptions } from "../types.js";

/**
 * Configuration for the DreamingAgent.
 */
export interface DreamingAgentOptions {
  /** Honcho provider options. */
  provider: HonchoProviderOptions;
  /** The observer peer ID (the agent doing the dreaming). */
  observerPeerId: string;
  /** The observed peer ID (the entity being dreamed about). Default: same as observer. */
  observedPeerId?: string;
  /** Session ID to scope dreams to. */
  sessionId: string;
  /**
   * Webhook URL to receive dream completion events.
   * If provided, a webhook endpoint will be registered.
   */
  webhookUrl?: string;
  /**
   * Reflection queries the agent asks itself during reflection cycles.
   * Defaults to a set of introspective queries.
   */
  reflectionQueries?: string[];
}

/**
 * Result of a reflection cycle.
 */
export interface ReflectionResult {
  query: string;
  insight: string;
}

/**
 * Queue status snapshot.
 */
export interface DreamStatus {
  pending: number;
  inProgress: number;
  completed: number;
  total: number;
  isActive: boolean;
}

const DEFAULT_REFLECTION_QUERIES = [
  "What patterns have I noticed in this user's behavior across our interactions?",
  "What contradictions or tensions exist in what I know about this user?",
  "What are the most important things I've learned recently that change my understanding?",
  "What gaps exist in my understanding of this user that I should try to fill?",
  "What implicit preferences or values can I infer from their explicit statements?",
];

/**
 * An autonomous dreaming agent that consolidates memories, self-reflects,
 * and surfaces insights without being asked.
 *
 * Dreams are Honcho's async consolidation process: deduction (logical inference,
 * contradiction resolution, knowledge updates) + induction (pattern recognition,
 * behavioral tendencies, personality traits).
 *
 * @example
 * ```ts
 * const dreamer = await createDreamingAgent({
 *   provider: { workspaceId: "ws-1" },
 *   observerPeerId: "agent-narrator",
 *   sessionId: "session-1",
 *   webhookUrl: "https://my-app.dev/webhooks/honcho",
 * });
 *
 * // Trigger a dream cycle
 * await dreamer.dream();
 *
 * // Check if dreaming is in progress
 * const status = await dreamer.getStatus();
 * console.log(status.isActive);
 *
 * // Run a self-reflection cycle
 * const insights = await dreamer.reflect();
 * for (const { query, insight } of insights) {
 *   console.log(`${query}: ${insight}`);
 * }
 *
 * // Run a full cycle: dream, wait, reflect
 * const results = await dreamer.fullCycle();
 * ```
 */
export interface DreamingAgent {
  /** The Honcho client. */
  client: Honcho;
  /** Workspace ID. */
  workspaceId: string;
  /** Observer peer ID. */
  observerPeerId: string;
  /** Observed peer ID. */
  observedPeerId: string;
  /** Session ID. */
  sessionId: string;

  /**
   * Trigger a dream cycle. Bypasses automatic thresholds.
   * Dreams consolidate conclusions via deduction + induction.
   */
  dream(): Promise<void>;

  /**
   * Get the current queue status for this observer/observed pair.
   */
  getStatus(): Promise<DreamStatus>;

  /**
   * Wait for all pending dream work to complete.
   * Polls queue status at the given interval.
   */
  waitForCompletion(pollIntervalMs?: number, timeoutMs?: number): Promise<void>;

  /**
   * Run a self-reflection cycle using the dialectic API.
   * Asks introspective questions and returns synthesized insights.
   */
  reflect(queries?: string[]): Promise<ReflectionResult[]>;

  /**
   * Full dream cycle: trigger dream, wait for completion, then reflect.
   * Returns the reflection results after consolidation.
   */
  fullCycle(options?: {
    queries?: string[];
    pollIntervalMs?: number;
    timeoutMs?: number;
  }): Promise<ReflectionResult[]>;

  /**
   * Ask a specific question about the observed peer using the dialectic API.
   */
  ask(query: string): Promise<string>;

  /**
   * Register a webhook URL for dream completion events.
   */
  registerWebhook(url: string): Promise<{ id: string; url: string }>;

  /**
   * Get what has changed: query recent conclusions since a given timestamp.
   */
  getRecentConclusions(since?: string, limit?: number): Promise<Array<{
    content: string;
    created_at: string;
  }>>;
}

/**
 * Create an autonomous dreaming agent.
 */
export async function createDreamingAgent(
  options: DreamingAgentOptions
): Promise<DreamingAgent> {
  const {
    provider,
    observerPeerId,
    sessionId,
    reflectionQueries = DEFAULT_REFLECTION_QUERIES,
  } = options;
  const observedPeerId = options.observedPeerId ?? observerPeerId;
  const client = createClient(provider);
  const workspaceId = client.workspaceId;
  const observerPeer = await client.peer(observerPeerId);
  const observedPeer =
    observedPeerId !== observerPeerId
      ? await client.peer(observedPeerId)
      : observerPeer;

  // Register webhook if provided (best effort).
  if (options.webhookUrl) {
    await client.http
      .post<{ id: string; url: string }>(`/v3/workspaces/${workspaceId}/webhooks`, {
        body: { url: options.webhookUrl },
      })
      .catch(() => {});
  }

  const agent: DreamingAgent = {
    client,
    workspaceId,
    observerPeerId,
    observedPeerId,
    sessionId,

    async dream() {
      await client.scheduleDream({
        observer: observerPeerId,
        observed: observedPeerId,
        session: sessionId,
      });
    },

    async getStatus() {
      const status = await client.queueStatus({
        observer: observerPeerId,
        session: sessionId,
      });

      return {
        pending: status.pendingWorkUnits,
        inProgress: status.inProgressWorkUnits,
        completed: status.completedWorkUnits,
        total: status.totalWorkUnits,
        isActive:
          status.pendingWorkUnits > 0 || status.inProgressWorkUnits > 0,
      };
    },

    async waitForCompletion(pollIntervalMs = 3000, timeoutMs = 300000) {
      const start = Date.now();

      while (Date.now() - start < timeoutMs) {
        const status = await agent.getStatus();
        if (!status.isActive) return;

        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }

      throw new Error(
        `Dream completion timed out after ${timeoutMs}ms`
      );
    },

    async reflect(queries) {
      const activeQueries = queries ?? reflectionQueries;

      const results = await Promise.all(
        activeQueries.map(async (query) => {
          const insight = await observerPeer.chat(query, {
            target: observedPeerId !== observerPeerId ? observedPeer : undefined,
            session: sessionId,
          });

          return { query, insight: insight ?? "" };
        })
      );

      return results;
    },

    async fullCycle(cycleOptions) {
      await agent.dream();
      await agent.waitForCompletion(
        cycleOptions?.pollIntervalMs,
        cycleOptions?.timeoutMs
      );
      return agent.reflect(cycleOptions?.queries);
    },

    async ask(query) {
      const response = await observerPeer.chat(query, {
        target: observedPeerId !== observerPeerId ? observedPeer : undefined,
        session: sessionId,
      });
      return response ?? "";
    },

    async registerWebhook(url) {
      const endpoint = await client.http.post<{ id: string; url: string }>(
        `/v3/workspaces/${workspaceId}/webhooks`,
        { body: { url } }
      );
      return { id: endpoint.id, url: endpoint.url };
    },

    async getRecentConclusions(since, limit = 20) {
      const conclusions = await observerPeer
        .conclusionsOf(observedPeer)
        .list({ size: limit, session: sessionId });

      let items = conclusions.items;

      if (since) {
        const sinceDate = new Date(since);
        items = items.filter(
          (c) => new Date(c.createdAt) > sinceDate
        );
      }

      return items.map((c) => ({
        content: c.content,
        created_at: c.createdAt,
      }));
    },
  };

  return agent;
}
