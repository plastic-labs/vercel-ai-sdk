import type Honcho from "@honcho-ai/core";

/**
 * Configuration for the Honcho provider factory.
 */
export interface HonchoProviderOptions {
  /** Honcho API key. Falls back to HONCHO_API_KEY env var. */
  apiKey?: string;
  /** Workspace ID to scope all operations to. */
  workspaceId: string;
  /** Default peer ID used when not overridden per-call. */
  defaultPeerId?: string;
  /** Default session ID used when not overridden per-call. */
  defaultSessionId?: string;
  /** Honcho environment: 'production' or 'local'. */
  environment?: "production" | "local";
  /** Custom base URL (overrides environment). */
  baseURL?: string;
}

/**
 * Per-call options passed via providerOptions.honcho in AI SDK,
 * or as runtime parameters in other frameworks.
 */
export interface HonchoCallOptions {
  /** Peer ID for this call. Overrides defaultPeerId. */
  peerId?: string;
  /** Session ID for this call. Overrides defaultSessionId. */
  sessionId?: string;
  /** Whether to inject peer context into the system prompt. Default: true. */
  injectContext?: boolean;
  /** Whether to persist messages to Honcho after generation. Default: true. */
  persistMessages?: boolean;
  /** Peer ID whose perspective to use for representation. */
  targetPeerId?: string;
  /** Max tokens for session context retrieval. */
  contextTokens?: number;
  /** Include session summary in context. Default: true. */
  includeSummary?: boolean;
}

/**
 * Configuration for the Honcho middleware layer.
 */
export interface HonchoMiddlewareOptions {
  /** Whether to inject peer/session context into the system prompt. Default: true. */
  injectContext?: boolean;
  /** Whether to persist messages after generation. Default: true. */
  persistMessages?: boolean;
  /** Custom function to format injected context. */
  formatContext?: (context: HonchoContextData) => string;
}

/**
 * Data retrieved from Honcho for context injection.
 */
export interface HonchoContextData {
  /** Peer representation text (long-form understanding of the user). */
  representation?: string | null;
  /** Peer card entries (structured facts). */
  peerCard?: string[] | null;
  /** Session summary text. */
  summary?: string | null;
  /** Recent session messages for context. */
  messages?: Array<{ content: string; peer_id: string }>;
}

/**
 * Resolved configuration with all defaults applied.
 */
export interface ResolvedHonchoConfig {
  client: Honcho;
  workspaceId: string;
  peerId: string;
  sessionId?: string;
  targetPeerId?: string;
  injectContext: boolean;
  persistMessages: boolean;
  contextTokens?: number;
  includeSummary: boolean;
  formatContext: (context: HonchoContextData) => string;
}
