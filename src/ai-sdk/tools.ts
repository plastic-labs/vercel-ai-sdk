import { tool } from "ai";
import { z } from "zod";
import type Honcho from "@honcho-ai/core";
import { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "../shared/descriptions.js";

export interface HonchoToolsConfig {
  /** Honcho client instance. */
  client: Honcho;
  /** Workspace ID. */
  workspaceId: string;
  /** Default peer ID. Can be overridden per-tool via input schema. */
  defaultPeerId?: string;
  /** Default session ID. */
  defaultSessionId?: string;
  /** Default peer ID for the AI/observer perspective. */
  defaultObserverPeerId?: string;
}

/**
 * Dialectic chat tool -- ask questions about a user using Honcho's
 * reasoning engine. This is Honcho's killer feature.
 */
export function honchoChatTool(config: HonchoToolsConfig) {
  const { client, workspaceId, defaultPeerId } = config;

  return tool({
    description: TOOL_DESCRIPTIONS.chat,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      peerId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.peerId),
    }),
    execute: async ({ query, peerId }) => {
      const pid = peerId ?? defaultPeerId;
      if (!pid) throw new Error("peerId is required for honcho_chat");

      const response = await client.workspaces.peers.chat(
        workspaceId,
        pid,
        { query }
      );
      return { content: response.content };
    },
  });
}

/**
 * Semantic search across stored conversation messages for a peer.
 */
export function honchoSearchTool(config: HonchoToolsConfig) {
  const { client, workspaceId, defaultPeerId } = config;

  return tool({
    description: TOOL_DESCRIPTIONS.search,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      peerId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.peerId),
      limit: z
        .number()
        .optional()
        .default(DEFAULTS.searchLimit)
        .describe(PARAM_DESCRIPTIONS.limit),
    }),
    execute: async ({ query, peerId, limit }) => {
      const pid = peerId ?? defaultPeerId;
      if (!pid) throw new Error("peerId is required for honcho_search");

      const results = await client.workspaces.peers.search(
        workspaceId,
        pid,
        { query, limit }
      );
      return {
        results: results.map((m) => ({
          content: m.content,
          peer_id: m.peer_id,
          created_at: m.created_at,
        })),
        count: results.length,
      };
    },
  });
}

/**
 * Get session-aware context (representation, card, summary, recent messages)
 * from an observer's perspective about a target peer.
 */
export function honchoContextTool(config: HonchoToolsConfig) {
  const {
    client,
    workspaceId,
    defaultPeerId,
    defaultObserverPeerId,
    defaultSessionId,
  } = config;

  return tool({
    description: TOOL_DESCRIPTIONS.getContext,
    inputSchema: z.object({
      peerId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.peerId),
      observerId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.observerId),
      sessionId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.sessionId),
      includeSummary: z
        .boolean()
        .optional()
        .default(true)
        .describe(PARAM_DESCRIPTIONS.includeSummary),
      tokens: z
        .number()
        .int()
        .positive()
        .optional()
        .default(DEFAULTS.contextTokens)
        .describe(PARAM_DESCRIPTIONS.contextTokens),
      messageLimit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .default(DEFAULTS.contextMessageLimit)
        .describe(PARAM_DESCRIPTIONS.messageLimit),
    }),
    execute: async ({
      peerId,
      observerId,
      sessionId,
      includeSummary,
      tokens,
      messageLimit,
    }) => {
      const target = peerId ?? defaultPeerId;
      const observer = observerId ?? defaultObserverPeerId ?? target;
      const session = sessionId ?? defaultSessionId;

      if (!target) throw new Error("peerId is required for honcho_context");
      if (!observer) throw new Error("observerId is required for honcho_context");

      if (session) {
        const hasPeerPair = observer !== target;
        const ctx = await client.workspaces.sessions.context(
          workspaceId,
          session,
          {
            peer_perspective: hasPeerPair ? observer : undefined,
            peer_target: hasPeerPair ? target : undefined,
            summary: includeSummary,
            tokens,
          }
        );

        const messages = (ctx.messages ?? [])
          .slice(-messageLimit)
          .map((m) => ({
            content: m.content,
            peer_id: m.peer_id,
            role:
              m.peer_id === observer
                ? "observer"
                : m.peer_id === target
                  ? "target"
                  : "other",
          }));

        return {
          session_id: session,
          observer_id: observer,
          target_id: target,
          representation: ctx.peer_representation ?? null,
          peer_card: ctx.peer_card ?? null,
          summary: includeSummary ? (ctx.summary?.content ?? null) : null,
          messages,
          message_count: messages.length,
        };
      }

      const ctx = await client.workspaces.peers.context(
        workspaceId,
        observer,
        { target: observer === target ? undefined : target }
      );

      return {
        session_id: null,
        observer_id: observer,
        target_id: target,
        representation: ctx.representation ?? null,
        peer_card: ctx.peer_card ?? null,
        summary: null,
        messages: [],
        message_count: 0,
      };
    },
  });
}

/**
 * Query derived conclusions/observations about a user.
 */
export function honchoSearchConclusionsTool(config: HonchoToolsConfig) {
  const { client, workspaceId } = config;

  return tool({
    description: TOOL_DESCRIPTIONS.searchConclusions,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      limit: z
        .number()
        .optional()
        .default(DEFAULTS.conclusionTopK)
        .describe(PARAM_DESCRIPTIONS.limit),
    }),
    execute: async ({ query, limit }) => {
      const results = await client.workspaces.conclusions.query(
        workspaceId,
        { query, top_k: limit }
      );
      return {
        results: results.map((c) => ({
          content: c.content,
          observed_id: c.observed_id,
          observer_id: c.observer_id,
          created_at: c.created_at,
        })),
        count: results.length,
      };
    },
  });
}

/**
 * Get a comprehensive representation of what is known about a user.
 */
export function honchoGetRepresentationTool(config: HonchoToolsConfig) {
  const { client, workspaceId, defaultPeerId } = config;

  return tool({
    description: TOOL_DESCRIPTIONS.getRepresentation,
    inputSchema: z.object({
      peerId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.peerId),
    }),
    execute: async ({ peerId }) => {
      const pid = peerId ?? defaultPeerId;
      if (!pid)
        throw new Error("peerId is required for honcho_get_representation");

      const response = await client.workspaces.peers.representation(
        workspaceId,
        pid,
        {}
      );
      return { representation: response.representation };
    },
  });
}

/**
 * Save an observation or conclusion about a user.
 */
export function honchoSaveConclusionTool(config: HonchoToolsConfig) {
  const { client, workspaceId, defaultPeerId, defaultObserverPeerId, defaultSessionId } = config;

  return tool({
    description: TOOL_DESCRIPTIONS.saveConclusion,
    inputSchema: z.object({
      content: z.string().describe(PARAM_DESCRIPTIONS.content),
      observedId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.observedId),
      observerId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.observerId),
      sessionId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.sessionId),
    }),
    execute: async ({ content, observedId, observerId, sessionId }) => {
      const observed = observedId ?? defaultPeerId;
      const observer = observerId ?? defaultObserverPeerId;
      const session = sessionId ?? defaultSessionId;
      if (!observed)
        throw new Error("observedId is required for honcho_save_conclusion");
      if (!observer)
        throw new Error("observerId is required for honcho_save_conclusion");
      if (!session)
        throw new Error("sessionId is required for honcho_save_conclusion");

      const results = await client.workspaces.conclusions.create(
        workspaceId,
        { conclusions: [{ content, observed_id: observed, observer_id: observer, session_id: session }] }
      );
      return { success: true, id: results[0]?.id ?? "" };
    },
  });
}

/**
 * Returns all Honcho tools as a spreadable object.
 *
 * @example
 * ```ts
 * const result = await generateText({
 *   model: openai("gpt-4o"),
 *   tools: honchoTools({ client, workspaceId, defaultPeerId: "user-123" }),
 *   prompt: "What did we talk about last week?",
 * });
 * ```
 */
export function honchoTools(config: HonchoToolsConfig) {
  return {
    honcho_chat: honchoChatTool(config),
    honcho_context: honchoContextTool(config),
    honcho_search: honchoSearchTool(config),
    honcho_search_conclusions: honchoSearchConclusionsTool(config),
    honcho_get_representation: honchoGetRepresentationTool(config),
    honcho_save_conclusion: honchoSaveConclusionTool(config),
  };
}
