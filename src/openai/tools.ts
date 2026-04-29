import type { Honcho, Peer, Session } from "@honcho-ai/sdk";
import { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "../shared/descriptions.js";

/**
 * OpenAI function calling tool definitions for Honcho.
 * These produce the `tools` array format expected by the OpenAI Chat Completions API.
 */

export interface HonchoOpenAIToolsConfig {
  client: Honcho;
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

function parseBooleanArg(
  value: unknown,
  fallback: boolean,
  fieldName: string
): boolean {
  if (value == null) return fallback;
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }

  throw new Error(`${fieldName} must be a boolean`);
}

function parseIntegerArg(
  value: unknown,
  fallback: number,
  fieldName: string,
  range: { min: number; max?: number }
): number {
  if (value == null) return fallback;

  const numericValue =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : NaN;

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${fieldName} must be a number`);
  }

  const intValue = Math.floor(numericValue);
  if (intValue < range.min) {
    throw new Error(`${fieldName} must be >= ${range.min}`);
  }
  if (range.max != null && intValue > range.max) {
    throw new Error(`${fieldName} must be <= ${range.max}`);
  }

  return intValue;
}

/**
 * Create OpenAI-compatible tool definitions and executor for Honcho.
 *
 * @example
 * ```ts
 * import { honchoOpenAITools } from "@honcho-ai/ai-sdk/openai";
 * import OpenAI from "openai";
 *
 * const openai = new OpenAI();
 * const honcho = honchoOpenAITools({ client, defaultPeerId: "user-123" });
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
  const { client, defaultPeerId, defaultSessionId, defaultObserverPeerId } = config;

  const peerCache = new Map<string, Promise<Peer>>();
  const sessionCache = new Map<string, Promise<Session>>();
  const sessionSetupCache = new Map<string, Promise<void>>();

  const cachePromise = <T>(
    cache: Map<string, Promise<T>>,
    key: string,
    factory: () => Promise<T>
  ): Promise<T> => {
    const existing = cache.get(key);
    if (existing) {
      return existing;
    }
    const promise = factory().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
    return promise;
  };

  const ensurePeer = (peerId: string, observeMe: boolean): Promise<Peer> => {
    const key = `${peerId}::${observeMe}`;
    return cachePromise(peerCache, key, () =>
      client.peer(peerId, { configuration: { observeMe } })
    );
  };

  const ensureSession = (sessionId: string): Promise<Session> =>
    cachePromise(sessionCache, sessionId, () => client.session(sessionId));

  const ensureSessionPeers = async (
    sessionId: string,
    userId: string,
    assistantId: string
  ) => {
    const session = await ensureSession(sessionId);
    const userPeer = await ensurePeer(userId, true);
    const assistantPeer = await ensurePeer(assistantId, false);

    const setupKey = `${sessionId}::${userId}::${assistantId}`;
    const setupPromise = sessionSetupCache.get(setupKey) ?? (() => {
      const promise = session
        .addPeers([
          [userPeer, { observeMe: true, observeOthers: false }],
          [assistantPeer, { observeMe: false, observeOthers: true }],
        ])
        .catch((error) => {
          sessionSetupCache.delete(setupKey);
          throw error;
        });
      sessionSetupCache.set(setupKey, promise);
      return promise;
    })();
    await setupPromise;

    return { session, userPeer, assistantPeer };
  };

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
            observerId: {
              type: "string",
              description: PARAM_DESCRIPTIONS.observerId,
            },
            sessionId: {
              type: "string",
              description: PARAM_DESCRIPTIONS.sessionId,
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "honcho_context",
        description: TOOL_DESCRIPTIONS.getContext,
        parameters: {
          type: "object",
          properties: {
            peerId: { type: "string", description: PARAM_DESCRIPTIONS.peerId },
            observerId: {
              type: "string",
              description: PARAM_DESCRIPTIONS.observerId,
            },
            sessionId: {
              type: "string",
              description: PARAM_DESCRIPTIONS.sessionId,
            },
            includeSummary: {
              type: "boolean",
              description: PARAM_DESCRIPTIONS.includeSummary,
            },
            tokens: {
              type: "number",
              description: PARAM_DESCRIPTIONS.contextTokens,
            },
            messageLimit: {
              type: "number",
              description: PARAM_DESCRIPTIONS.messageLimit,
            },
          },
          required: [],
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
            peerId: { type: "string", description: PARAM_DESCRIPTIONS.peerId },
            observerId: {
              type: "string",
              description: PARAM_DESCRIPTIONS.observerId,
            },
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
            observerId: {
              type: "string",
              description: PARAM_DESCRIPTIONS.observerId,
            },
            sessionId: {
              type: "string",
              description: PARAM_DESCRIPTIONS.sessionId,
            },
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
      const userId = (args.peerId as string) ?? defaultPeerId;
      const assistantId = (args.observerId as string) ?? defaultObserverPeerId ?? DEFAULTS.assistantPeerId;
      const sessionId = (args.sessionId as string) ?? defaultSessionId;
      if (!userId) throw new Error("peerId is required");

      const assistantPeer = await ensurePeer(assistantId, false);
      const response = await assistantPeer.chat(args.query as string, {
        target: userId,
        session: sessionId,
      });
      return { content: response ?? "" };
    },

    honcho_context: async (args) => {
      const target = (args.peerId as string) ?? defaultPeerId;
      const observer = (args.observerId as string) ?? defaultObserverPeerId ?? target;
      const session = (args.sessionId as string) ?? defaultSessionId;
      const includeSummary = parseBooleanArg(
        args.includeSummary,
        true,
        "includeSummary"
      );
      const tokens = parseIntegerArg(
        args.tokens,
        DEFAULTS.contextTokens,
        "tokens",
        { min: 1 }
      );
      const messageLimit = parseIntegerArg(
        args.messageLimit,
        DEFAULTS.contextMessageLimit,
        "messageLimit",
        { min: 1, max: 50 }
      );

      if (!target) throw new Error("peerId is required");
      if (!observer) throw new Error("observerId is required");

      if (session) {
        const { session: sdkSession } = await ensureSessionPeers(
          session,
          target,
          observer
        );
        const context = await sdkSession.context({
          peerPerspective: observer,
          peerTarget: target,
          summary: includeSummary,
          tokens,
        });

        const messages = context.messages
          .slice(-messageLimit)
          .map((message) => ({
            content: message.content,
            peer_id: message.peerId,
            role:
              message.peerId === observer
                ? "observer"
                : message.peerId === target
                  ? "target"
                  : "other",
          }));

        return {
          session_id: session,
          observer_id: observer,
          target_id: target,
          representation: context.peerRepresentation ?? null,
          peer_card: context.peerCard ?? null,
          summary: includeSummary ? (context.summary?.content ?? null) : null,
          messages,
          message_count: messages.length,
        };
      }

      const observerPeer = await ensurePeer(observer, false);
      const context = await observerPeer.context({
        target: observer === target ? undefined : target,
      });

      return {
        session_id: null,
        observer_id: observer,
        target_id: target,
        representation: context.representation ?? null,
        peer_card: context.peerCard ?? null,
        summary: null,
        messages: [],
        message_count: 0,
      };
    },

    honcho_search: async (args) => {
      const userId = (args.peerId as string) ?? defaultPeerId;
      if (!userId) throw new Error("peerId is required");

      const userPeer = await ensurePeer(userId, true);
      const results = await userPeer.search(args.query as string, {
        limit: (args.limit as number) ?? DEFAULTS.searchLimit,
      });

      return {
        results: results.map((m) => ({
          content: m.content,
          peer_id: m.peerId,
          created_at: m.createdAt,
        })),
        count: results.length,
      };
    },

    honcho_search_conclusions: async (args) => {
      const target = (args.peerId as string) ?? defaultPeerId;
      const observer = (args.observerId as string) ?? defaultObserverPeerId ?? DEFAULTS.assistantPeerId;
      if (!target) throw new Error("peerId is required");
      if (!observer) throw new Error("observerId is required");

      const observerPeer = await ensurePeer(observer, false);
      const results = await observerPeer
        .conclusionsOf(target)
        .query(
          args.query as string,
          (args.limit as number) ?? DEFAULTS.conclusionTopK
        );

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

    honcho_get_representation: async (args) => {
      const target = (args.peerId as string) ?? defaultPeerId;
      const observer = (args.observerId as string) ?? defaultObserverPeerId ?? DEFAULTS.assistantPeerId;
      const session = (args.sessionId as string) ?? defaultSessionId;
      if (!target) throw new Error("peerId is required");
      if (!observer) throw new Error("observerId is required");

      const observerPeer = await ensurePeer(observer, false);
      const representation = await observerPeer.representation({
        target,
        session,
      });

      return { representation };
    },

    honcho_save_conclusion: async (args) => {
      const observed = (args.observedId as string) ?? defaultPeerId;
      const observer = (args.observerId as string) ?? defaultObserverPeerId ?? DEFAULTS.assistantPeerId;
      const session = (args.sessionId as string) ?? defaultSessionId;
      if (!observed) throw new Error("observedId is required");
      if (!observer) throw new Error("observerId is required");
      if (!session) throw new Error("sessionId is required");

      const { assistantPeer } = await ensureSessionPeers(session, observed, observer);
      const results = await assistantPeer
        .conclusionsOf(observed)
        .create({
          content: args.content as string,
          sessionId: session,
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
