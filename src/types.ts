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
  /** Default user peer ID for middleware/tools/send when omitted. */
  defaultUserId?: string;
  /** Default assistant peer ID for middleware/tools when omitted. */
  defaultAssistantId?: string;
  /** Default session ID for middleware/tools/send when omitted. */
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
}

/**
 * Flat middleware config for AI SDK model wrapping.
 */
export interface HonchoMiddlewareConfig {
  /** Observed peer (typically the end user). */
  userId?: string;
  /** Conversation/session/thread identifier. Enables persistence + full context. */
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
  /** Observed peer (typically the end user). */
  userId?: string;
  /** Optional session identifier for scoped retrieval. */
  sessionId?: string | null;
  /** AI peer identity for observer-scoped tools. Defaults to "assistant". */
  assistantId?: string;
}

/**
 * Message persistence helper config.
 */
export interface HonchoSendConfig {
  userId?: string;
  sessionId?: string | null;
  content: string;
}
