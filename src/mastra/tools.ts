import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type Honcho from "@honcho-ai/core";
import { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "../shared/descriptions.js";

export interface HonchoMastraToolsConfig {
  client: Honcho;
  workspaceId: string;
  defaultPeerId?: string;
  defaultSessionId?: string;
  defaultObserverPeerId?: string;
}

/**
 * Dialectic chat -- ask questions about a user using Honcho's reasoning engine.
 */
export function honchoMastraChatTool(config: HonchoMastraToolsConfig) {
  const { client, workspaceId, defaultPeerId } = config;

  return createTool({
    id: "honcho_chat",
    description: TOOL_DESCRIPTIONS.chat,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      peerId: z.string().optional().describe(PARAM_DESCRIPTIONS.peerId),
    }),
    outputSchema: z.object({
      content: z.string(),
    }),
    execute: async ({ context }) => {
      const peerId = context.peerId ?? defaultPeerId;
      if (!peerId) throw new Error("peerId is required");

      const response = await client.workspaces.peers.chat(
        workspaceId,
        peerId,
        { query: context.query }
      );
      return { content: response.content };
    },
  });
}

/**
 * Semantic search across stored messages.
 */
export function honchoMastraSearchTool(config: HonchoMastraToolsConfig) {
  const { client, workspaceId, defaultPeerId } = config;

  return createTool({
    id: "honcho_search",
    description: TOOL_DESCRIPTIONS.search,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      peerId: z.string().optional().describe(PARAM_DESCRIPTIONS.peerId),
      limit: z.number().optional().default(DEFAULTS.searchLimit).describe(PARAM_DESCRIPTIONS.limit),
    }),
    outputSchema: z.object({
      results: z.array(z.object({
        content: z.string(),
        peer_id: z.string(),
        created_at: z.string(),
      })),
      count: z.number(),
    }),
    execute: async ({ context }) => {
      const peerId = context.peerId ?? defaultPeerId;
      if (!peerId) throw new Error("peerId is required");

      const results = await client.workspaces.peers.search(workspaceId, peerId, {
        query: context.query,
        limit: context.limit,
      });
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
 * Query derived conclusions about a user.
 */
export function honchoMastraSearchConclusionsTool(config: HonchoMastraToolsConfig) {
  const { client, workspaceId } = config;

  return createTool({
    id: "honcho_search_conclusions",
    description: TOOL_DESCRIPTIONS.searchConclusions,
    inputSchema: z.object({
      query: z.string().describe(PARAM_DESCRIPTIONS.query),
      limit: z.number().optional().default(DEFAULTS.conclusionTopK).describe(PARAM_DESCRIPTIONS.limit),
    }),
    outputSchema: z.object({
      results: z.array(z.object({
        content: z.string(),
        observed_id: z.string(),
        created_at: z.string(),
      })),
      count: z.number(),
    }),
    execute: async ({ context }) => {
      const results = await client.workspaces.conclusions.query(workspaceId, {
        query: context.query,
        top_k: context.limit,
      });
      return {
        results: results.map((c) => ({
          content: c.content,
          observed_id: c.observed_id,
          created_at: c.created_at,
        })),
        count: results.length,
      };
    },
  });
}

/**
 * Get a comprehensive user representation.
 */
export function honchoMastraGetRepresentationTool(config: HonchoMastraToolsConfig) {
  const { client, workspaceId, defaultPeerId } = config;

  return createTool({
    id: "honcho_get_representation",
    description: TOOL_DESCRIPTIONS.getRepresentation,
    inputSchema: z.object({
      peerId: z.string().optional().describe(PARAM_DESCRIPTIONS.peerId),
    }),
    outputSchema: z.object({
      representation: z.string(),
    }),
    execute: async ({ context }) => {
      const peerId = context.peerId ?? defaultPeerId;
      if (!peerId) throw new Error("peerId is required");

      const response = await client.workspaces.peers.representation(
        workspaceId,
        peerId,
        {}
      );
      return { representation: response.representation };
    },
  });
}

/**
 * Save a conclusion about a user.
 */
export function honchoMastraSaveConclusionTool(config: HonchoMastraToolsConfig) {
  const { client, workspaceId, defaultPeerId, defaultSessionId, defaultObserverPeerId } = config;

  return createTool({
    id: "honcho_save_conclusion",
    description: TOOL_DESCRIPTIONS.saveConclusion,
    inputSchema: z.object({
      content: z.string().describe(PARAM_DESCRIPTIONS.content),
      observedId: z.string().optional().describe(PARAM_DESCRIPTIONS.observedId),
      observerId: z.string().optional().describe(PARAM_DESCRIPTIONS.observerId),
      sessionId: z.string().optional().describe(PARAM_DESCRIPTIONS.sessionId),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      id: z.string(),
    }),
    execute: async ({ context }) => {
      const observed = context.observedId ?? defaultPeerId;
      const observer = context.observerId ?? defaultObserverPeerId;
      const session = context.sessionId ?? defaultSessionId;
      if (!observed) throw new Error("observedId is required");
      if (!observer) throw new Error("observerId is required");
      if (!session) throw new Error("sessionId is required");

      const results = await client.workspaces.conclusions.create(workspaceId, {
        conclusions: [{
          content: context.content,
          observed_id: observed,
          observer_id: observer,
          session_id: session,
        }],
      });
      return { success: true, id: results[0]?.id ?? "" };
    },
  });
}

/**
 * Returns all Honcho tools for Mastra agents.
 *
 * @example
 * ```ts
 * import { Agent } from "@mastra/core/agent";
 * import { honchoMastraTools } from "@honcho-ai/tools/mastra";
 *
 * const tools = honchoMastraTools({ client, workspaceId, defaultPeerId: "user-123" });
 *
 * const agent = new Agent({
 *   id: "my-agent",
 *   model: openai("gpt-4o"),
 *   tools,
 * });
 * ```
 */
export function honchoMastraTools(config: HonchoMastraToolsConfig) {
  return {
    honcho_chat: honchoMastraChatTool(config),
    honcho_search: honchoMastraSearchTool(config),
    honcho_search_conclusions: honchoMastraSearchConclusionsTool(config),
    honcho_get_representation: honchoMastraGetRepresentationTool(config),
    honcho_save_conclusion: honchoMastraSaveConclusionTool(config),
  };
}
