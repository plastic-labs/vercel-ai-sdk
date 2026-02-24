import type Honcho from "@honcho-ai/core";
import type {
  HonchoProviderOptions,
  HonchoMiddlewareOptions,
} from "../types.js";
import { createClient } from "../shared/context.js";
import { createHonchoMiddleware } from "./middleware.js";
import { honchoTools } from "./tools.js";
import type { HonchoToolsConfig } from "./tools.js";

export type { HonchoToolsConfig } from "./tools.js";

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
  /** Create middleware for wrapLanguageModel(). */
  middleware: (options?: HonchoMiddlewareOptions) => ReturnType<typeof createHonchoMiddleware>;
  /** Create tools spreadable into generateText/streamText. */
  tools: (overrides?: Partial<HonchoToolsConfig>) => ReturnType<typeof honchoTools>;
  /** The underlying Honcho client for direct API access. */
  client: Honcho;
}

/**
 * Create a Honcho provider with tools and middleware for the Vercel AI SDK.
 *
 * @example
 * ```ts
 * import { createHoncho } from "@honcho-ai/tools/ai-sdk";
 * import { wrapLanguageModel, generateText } from "ai";
 * import { anthropic } from "@ai-sdk/anthropic";
 *
 * const honcho = createHoncho({
 *   workspaceId: "my-workspace",
 *   defaultPeerId: "user-123",
 * });
 *
 * // Middleware: auto context injection + message persistence
 * const model = wrapLanguageModel({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   middleware: honcho.middleware(),
 * });
 *
 * // Tools: LLM-driven memory queries
 * const { text } = await generateText({
 *   model,
 *   tools: honcho.tools(),
 *   providerOptions: {
 *     honcho: { sessionId: "sess-456" },
 *   },
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

    client,
  };
}
