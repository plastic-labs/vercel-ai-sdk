import type Honcho from "@honcho-ai/core";
import type {
  HonchoProviderOptions,
  HonchoMiddlewareOptions,
  HonchoSessionPeers,
  HonchoSessionOptions,
} from "../types.js";
import { createClient } from "../shared/context.js";
import { createHonchoMiddleware } from "./middleware.js";
import { honchoTools } from "./tools.js";
import type { HonchoToolsConfig } from "./tools.js";
import { createSession } from "./session.js";
import type { HonchoSession } from "./session.js";

export type { HonchoToolsConfig } from "./tools.js";
export type { HonchoSession } from "./session.js";
export { createSession } from "./session.js";

export {
  honchoTools,
  honchoChatTool,
  honchoSearchTool,
  honchoSearchConclusionsTool,
  honchoGetRepresentationTool,
  honchoSaveConclusionTool,
} from "./tools.js";

export { createHonchoMiddleware } from "./middleware.js";

/**
 * The Honcho provider object returned by createHoncho().
 */
export interface HonchoProvider {
  /**
   * Create middleware for wrapLanguageModel().
   * @deprecated Use `session().middleware()` for correct dual-peer attribution.
   */
  middleware: (options?: HonchoMiddlewareOptions) => ReturnType<typeof createHonchoMiddleware>;
  /** Create tools spreadable into generateText/streamText. */
  tools: (overrides?: Partial<HonchoToolsConfig>) => ReturnType<typeof honchoTools>;
  /**
   * Create a session handle with separate user and assistant peers.
   * Synchronous -- no API calls until ensure() or first middleware use.
   *
   * @example
   * ```ts
   * const session = honcho.session("sess-123", {
   *   user: "user-abc",
   *   assistant: "assistant-xyz",
   * });
   *
   * const model = wrapLanguageModel({
   *   model: anthropic("claude-sonnet-4-20250514"),
   *   middleware: session.middleware(),
   * });
   *
   * const { text } = await generateText({
   *   model,
   *   tools: session.tools(),
   *   prompt: "What do you know about me?",
   * });
   * ```
   */
  session: (sessionId: string, peers: HonchoSessionPeers, options?: HonchoSessionOptions) => HonchoSession;
  /** The underlying Honcho client for direct API access. */
  client: Honcho;
}

/**
 * Create a Honcho provider with tools and middleware for the Vercel AI SDK.
 *
 * @example
 * ```ts
 * import { createHoncho } from "@honcho/ai-sdk";
 * import { wrapLanguageModel, generateText } from "ai";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * const honcho = createHoncho({
 *   workspaceId: "my-workspace",
 * });
 *
 * // Session-based API (recommended)
 * const session = honcho.session("sess-456", {
 *   user: "user-123",
 *   assistant: "assistant-456",
 * });
 *
 * const model = wrapLanguageModel({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   middleware: session.middleware(),
 * });
 *
 * const { text } = await generateText({
 *   model,
 *   tools: session.tools(),
 *   prompt: "What patterns have you noticed about me?",
 * });
 * ```
 */
export function createHoncho(options: HonchoProviderOptions): HonchoProvider {
  const client = createClient(options);

  return {
    middleware: (middlewareOptions?: HonchoMiddlewareOptions) =>
      createHonchoMiddleware(client, options, middlewareOptions),

    tools: (overrides?: Partial<HonchoToolsConfig>) =>
      honchoTools({
        client,
        workspaceId: options.workspaceId,
        defaultPeerId: options.defaultPeerId,
        defaultSessionId: options.defaultSessionId,
        ...overrides,
      }),

    session: (sessionId: string, peers: HonchoSessionPeers, sessionOptions?: HonchoSessionOptions) =>
      createSession(client, options.workspaceId, sessionId, peers, sessionOptions),

    client,
  };
}
