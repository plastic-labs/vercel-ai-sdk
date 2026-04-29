import type { SessionContext } from "@honcho-ai/sdk";

/**
 * Configuration for createHoncho().
 *
 * Most callers can use `createHoncho()` with no arguments and rely on
 * `HONCHO_API_KEY` plus implicit workspace fallback.
 */
export interface HonchoProviderOptions {
  /** Honcho API key. Falls back to HONCHO_API_KEY env var. */
  apiKey?: string;
  /** Workspace ID. Falls back to HONCHO_WORKSPACE_ID env var. */
  workspaceId?: string;
  /** Per-call `userId` > this > generated id with warn-once. Setting this suppresses the warning. */
  defaultUserId?: string;
  /** Per-call `assistantId` > this > `"assistant"`. */
  defaultAssistantId?: string;
  /** Per-call `sessionId` > this > generated id with warn-once. Setting this suppresses the warning. */
  defaultSessionId?: string;
  /** Optional API environment selector. */
  environment?: "production" | "local";
  /** Optional explicit API URL. Overrides environment. */
  baseURL?: string;
  /** Optional request timeout in milliseconds. */
  timeout?: number;
  /** Optional max retry attempts for HTTP calls. */
  maxRetries?: number;
  /** Optional additional default headers. */
  defaultHeaders?: Record<string, string>;
  /** Max distinct (assistantId, userId, sessionId) entries cached per provider. LRU-evicted by insertion order. Defaults to 1024. */
  maxCacheEntries?: number;
}

/**
 * Flat middleware config for AI SDK model wrapping.
 */
export interface HonchoMiddlewareConfig {
  /** Observed peer. Falls back to `defaultUserId` then a generated id with warn-once. */
  userId?: string;
  /** Session id. `null` opts out; omit to use `defaultSessionId` then a generated id with warn-once. */
  sessionId?: string | null;
  /** AI peer identity generating the response. Defaults to "assistant". */
  assistantId?: string;
  /** Persist the user's input message. Defaults to true. */
  persistInput?: boolean;
  /** Inject recent session messages from Honcho. Defaults to true. */
  injectHistory?: boolean;
  /** Custom context formatter. */
  formatContext?: (context: SessionContext) => string;
  /** Error hook for persistence/context failures. */
  onError?: (error: unknown) => void;
}

/**
 * Flat tools config.
 */
export interface HonchoToolsConfig {
  /** Observed peer (typically the end user). Falls back to `defaultUserId` then a generated id with warn-once. */
  userId?: string;
  /** Session id. `null` opts out of session-scoped retrieval; omit to use `defaultSessionId` then a generated id with warn-once. */
  sessionId?: string | null;
  /** AI peer identity for observer-scoped tools. Defaults to "assistant". */
  assistantId?: string;
}

/**
 * Message persistence helper config.
 */
export interface HonchoSendConfig {
  /** Peer the message is attributed to. Falls back to `defaultUserId` then a generated id with warn-once. */
  userId?: string;
  /** Session id. `null` throws (`send()` requires session mode); omit to use `defaultSessionId` then a generated id with warn-once. */
  sessionId?: string | null;
  /** AI peer the message is being sent to. Falls back to `defaultAssistantId` then `"assistant"`. Threads through to session setup so multi-peer flows attach the correct assistant. */
  assistantId?: string;
  /** Message content to persist. */
  content: string;
}
