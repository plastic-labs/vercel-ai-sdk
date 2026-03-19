import { tool } from "ai";
import { z } from "zod";
import { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "../shared/descriptions.js";
import type { Peer, Session } from "@honcho-ai/sdk";
import type { HonchoToolsConfig } from "../types.js";

export interface ResolvedToolsConfig {
  userId: string;
  sessionId?: string;
  assistantId: string;
}

export interface ToolResources {
  userPeer: Peer;
  assistantPeer: Peer;
  session?: Session;
}

export interface CreateToolsOptions {
  config: ResolvedToolsConfig;
  ensureResources: () => Promise<ToolResources>;
}

type SessionContextResult = {
  session_id: string | null;
  observer_id: string;
  target_id: string;
  representation: string | null;
  peer_card: string[] | null;
  summary: string | null;
  messages: Array<{
    content: string;
    peer_id: string;
    role: "assistant" | "user";
  }>;
  message_count: number;
};

/**
 * Dialectic chat tool -- ask questions about a user using Honcho's
 * reasoning engine. This is Honcho's killer feature.
 */
function honchoChatTool(options: CreateToolsOptions) {
  const { config, ensureResources } = options;
  return tool({
    description: TOOL_DESCRIPTIONS.chat,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      targetId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.targetPeerId),
    }),
    execute: async ({ query, targetId }) => {
      const { assistantPeer, session } = await ensureResources();
      const response = await assistantPeer.chat(query, {
        target: targetId ?? config.userId,
        session,
      });
      return { content: response ?? "" };
    },
  });
}

/**
 * Semantic search across stored conversation messages for a peer.
 */
function honchoSearchTool(options: CreateToolsOptions) {
  const { ensureResources } = options;
  return tool({
    description: TOOL_DESCRIPTIONS.search,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      limit: z
        .number()
        .optional()
        .default(DEFAULTS.searchLimit)
        .describe(PARAM_DESCRIPTIONS.limit),
    }),
    execute: async ({ query, limit }) => {
      const { userPeer } = await ensureResources();
      const results = await userPeer.search(query, { limit });
      return {
        results: results.map((m) => ({
          content: m.content,
          peer_id: m.peerId,
          created_at: m.createdAt,
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
function honchoContextTool(options: CreateToolsOptions) {
  const { config, ensureResources } = options;
  return tool({
    description: TOOL_DESCRIPTIONS.getContext,
    inputSchema: z.object({
      targetId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.targetPeerId),
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
      targetId,
      includeSummary,
      tokens,
      messageLimit,
    }): Promise<SessionContextResult> => {
      const { assistantPeer, session } = await ensureResources();
      const target = targetId ?? config.userId;

      if (session) {
        const context = await session.context({
          peerPerspective: config.assistantId,
          peerTarget: target,
          summary: includeSummary,
          tokens,
        });

        const messages = context.messages
          .slice(-messageLimit)
          .map((message) => ({
            content: message.content,
            peer_id: message.peerId,
            role: (message.peerId === config.assistantId ? "assistant" : "user") as "assistant" | "user",
          }));

        return {
          session_id: session.id,
          observer_id: config.assistantId,
          target_id: target,
          representation: context.peerRepresentation,
          peer_card: context.peerCard,
          summary: includeSummary ? context.summary?.content ?? null : null,
          messages,
          message_count: messages.length,
        } satisfies SessionContextResult;
      }

      const context = await assistantPeer.context({ target });

      return {
        session_id: null,
        observer_id: config.assistantId,
        target_id: target,
        representation: context.representation,
        peer_card: context.peerCard,
        summary: null,
        messages: [],
        message_count: 0,
      } satisfies SessionContextResult;
    },
  });
}

/**
 * Query derived conclusions/observations about a user.
 */
function honchoSearchConclusionsTool(options: CreateToolsOptions) {
  const { config, ensureResources } = options;
  return tool({
    description: TOOL_DESCRIPTIONS.searchConclusions,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      targetId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.targetPeerId),
      limit: z
        .number()
        .optional()
        .default(DEFAULTS.conclusionTopK)
        .describe(PARAM_DESCRIPTIONS.limit),
    }),
    execute: async ({ query, targetId, limit }) => {
      const { assistantPeer } = await ensureResources();
      const results = await assistantPeer
        .conclusionsOf(targetId ?? config.userId)
        .query(query, limit);
      return {
        results: results.map((c) => ({
          content: c.content,
          observed_id: c.observedId,
          observer_id: c.observerId,
          created_at: c.createdAt,
        })),
        count: results.length,
      };
    },
  });
}

/**
 * Get a comprehensive representation of what is known about a user.
 */
function honchoGetRepresentationTool(options: CreateToolsOptions) {
  const { config, ensureResources } = options;
  return tool({
    description: TOOL_DESCRIPTIONS.getRepresentation,
    inputSchema: z.object({
      targetId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.targetPeerId),
    }),
    execute: async ({ targetId }) => {
      const { assistantPeer, session } = await ensureResources();
      const representation = await assistantPeer.representation({
        target: targetId ?? config.userId,
        session,
      });
      return { representation };
    },
  });
}

/**
 * Save an observation or conclusion about a user.
 */
function honchoSaveConclusionTool(options: CreateToolsOptions) {
  const { config, ensureResources } = options;
  return tool({
    description: TOOL_DESCRIPTIONS.saveConclusion,
    inputSchema: z.object({
      content: z.string().describe(PARAM_DESCRIPTIONS.content),
      targetId: z
        .string()
        .optional()
        .describe(PARAM_DESCRIPTIONS.targetPeerId),
    }),
    execute: async ({ content, targetId }) => {
      const { assistantPeer, session } = await ensureResources();
      const results = await assistantPeer
        .conclusionsOf(targetId ?? config.userId)
        .create({
          content,
          sessionId: session?.id ?? config.sessionId,
        });

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
 *   tools: honcho.tools({ userId: "user-123", sessionId: "chat-456" }),
 *   prompt: "What did we talk about last week?",
 * });
 * ```
 */
export function createTools(options: CreateToolsOptions) {
  return {
    honcho_chat: honchoChatTool(options),
    honcho_context: honchoContextTool(options),
    honcho_search: honchoSearchTool(options),
    honcho_search_conclusions: honchoSearchConclusionsTool(options),
    honcho_get_representation: honchoGetRepresentationTool(options),
    honcho_save_conclusion: honchoSaveConclusionTool(options),
  };
}

export function resolveToolsConfig(config: HonchoToolsConfig): ResolvedToolsConfig {
  if (!config.userId || config.userId.trim().length === 0) {
    throw new Error("tools() requires userId (or defaultUserId in createHoncho).");
  }

  const assistantId = (config.assistantId ?? DEFAULTS.assistantPeerId).trim();
  if (!assistantId) {
    throw new Error("assistantId must be a non-empty string.");
  }

  return {
    userId: config.userId.trim(),
    sessionId: config.sessionId ?? undefined,
    assistantId,
  };
}
