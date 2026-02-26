import type Honcho from "@honcho-ai/core";
import { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "../shared/descriptions.js";

/**
 * OpenAI function calling tool definitions for Honcho.
 * These produce the `tools` array format expected by the OpenAI Chat Completions API.
 */

export interface HonchoOpenAIToolsConfig {
  client: Honcho;
  workspaceId: string;
  defaultPeerId?: string;
  defaultSessionId?: string;
  defaultObserverPeerId?: string;
}

export interface OpenAIToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface OpenAIToolExecutor {
  /** Tool definitions to pass to the OpenAI API. */
  definitions: OpenAIToolDefinition[];
  /** Execute a tool call by name. Returns the stringified result. */
  execute: (name: string, args: Record<string, unknown>) => Promise<string>;
}

/**
 * Create OpenAI-compatible tool definitions and executor for Honcho.
 *
 * @example
 * ```ts
 * import { honchoOpenAITools } from "@honcho/ai-sdk/openai";
 * import OpenAI from "openai";
 *
 * const openai = new OpenAI();
 * const honcho = honchoOpenAITools({ client, workspaceId, defaultPeerId: "user-123" });
 *
 * const response = await openai.chat.completions.create({
 *   model: "gpt-4o",
 *   messages: [{ role: "user", content: "What do you know about me?" }],
 *   tools: honcho.definitions,
 * });
 *
 * // Handle tool calls
 * for (const call of response.choices[0].message.tool_calls ?? []) {
 *   const result = await honcho.execute(call.function.name, JSON.parse(call.function.arguments));
 * }
 * ```
 */
export function honchoOpenAITools(config: HonchoOpenAIToolsConfig): OpenAIToolExecutor {
  const { client, workspaceId, defaultPeerId, defaultSessionId, defaultObserverPeerId } = config;

  const definitions: OpenAIToolDefinition[] = [
    {
      type: "function",
      function: {
        name: "honcho_chat",
        description: TOOL_DESCRIPTIONS.chat,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: PARAM_DESCRIPTIONS.query },
            peerId: { type: "string", description: PARAM_DESCRIPTIONS.peerId },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "honcho_search",
        description: TOOL_DESCRIPTIONS.search,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: PARAM_DESCRIPTIONS.query },
            peerId: { type: "string", description: PARAM_DESCRIPTIONS.peerId },
            limit: { type: "number", description: PARAM_DESCRIPTIONS.limit },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "honcho_search_conclusions",
        description: TOOL_DESCRIPTIONS.searchConclusions,
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: PARAM_DESCRIPTIONS.query },
            limit: { type: "number", description: PARAM_DESCRIPTIONS.limit },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "honcho_get_representation",
        description: TOOL_DESCRIPTIONS.getRepresentation,
        parameters: {
          type: "object",
          properties: {
            peerId: { type: "string", description: PARAM_DESCRIPTIONS.peerId },
          },
          required: [],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "honcho_save_conclusion",
        description: TOOL_DESCRIPTIONS.saveConclusion,
        parameters: {
          type: "object",
          properties: {
            content: { type: "string", description: PARAM_DESCRIPTIONS.content },
            observedId: { type: "string", description: PARAM_DESCRIPTIONS.observedId },
            observerId: { type: "string", description: PARAM_DESCRIPTIONS.observerId },
            sessionId: { type: "string", description: PARAM_DESCRIPTIONS.sessionId },
          },
          required: ["content"],
        },
      },
    },
  ];

  const executors: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    honcho_chat: async (args) => {
      const peerId = (args.peerId as string) ?? defaultPeerId;
      if (!peerId) throw new Error("peerId is required");
      return client.workspaces.peers.chat(workspaceId, peerId, {
        query: args.query as string,
      });
    },

    honcho_search: async (args) => {
      const peerId = (args.peerId as string) ?? defaultPeerId;
      if (!peerId) throw new Error("peerId is required");
      const results = await client.workspaces.peers.search(workspaceId, peerId, {
        query: args.query as string,
        limit: (args.limit as number) ?? DEFAULTS.searchLimit,
      });
      return { results: results.map((m) => ({ content: m.content, peer_id: m.peer_id, created_at: m.created_at })), count: results.length };
    },

    honcho_search_conclusions: async (args) => {
      const results = await client.workspaces.conclusions.query(workspaceId, {
        query: args.query as string,
        top_k: (args.limit as number) ?? DEFAULTS.conclusionTopK,
      });
      return { results: results.map((c) => ({ content: c.content, observed_id: c.observed_id, created_at: c.created_at })), count: results.length };
    },

    honcho_get_representation: async (args) => {
      const peerId = (args.peerId as string) ?? defaultPeerId;
      if (!peerId) throw new Error("peerId is required");
      return client.workspaces.peers.representation(workspaceId, peerId, {});
    },

    honcho_save_conclusion: async (args) => {
      const observed = (args.observedId as string) ?? defaultPeerId;
      const observer = (args.observerId as string) ?? defaultObserverPeerId;
      const session = (args.sessionId as string) ?? defaultSessionId;
      if (!observed) throw new Error("observedId is required");
      if (!observer) throw new Error("observerId is required");
      if (!session) throw new Error("sessionId is required");
      const results = await client.workspaces.conclusions.create(workspaceId, {
        conclusions: [{
          content: args.content as string,
          observed_id: observed,
          observer_id: observer,
          session_id: session,
        }],
      });
      return { success: true, id: results[0]?.id ?? "" };
    },
  };

  return {
    definitions,
    execute: async (name: string, args: Record<string, unknown>) => {
      const executor = executors[name];
      if (!executor) throw new Error(`Unknown tool: ${name}`);
      const result = await executor(args);
      return JSON.stringify(result);
    },
  };
}
