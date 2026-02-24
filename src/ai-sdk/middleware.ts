import type Honcho from "@honcho-ai/core";
import type {
  HonchoProviderOptions,
  HonchoCallOptions,
  HonchoMiddlewareOptions,
} from "../types.js";
import {
  resolveConfig,
  fetchContext,
  persistMessages,
} from "../shared/context.js";

/**
 * Creates a Vercel AI SDK middleware that automatically:
 * 1. Injects Honcho peer/session context into system prompts (transformParams)
 * 2. Persists user + assistant messages to Honcho after generation (wrapGenerate/wrapStream)
 *
 * @example
 * ```ts
 * import { wrapLanguageModel } from "ai";
 * import { createHonchoMiddleware } from "@honcho-ai/tools/ai-sdk";
 *
 * const model = wrapLanguageModel({
 *   model: anthropic("claude-sonnet-4-20250514"),
 *   middleware: createHonchoMiddleware(client, providerOptions),
 * });
 * ```
 */
export function createHonchoMiddleware(
  client: Honcho,
  providerOptions: HonchoProviderOptions,
  middlewareOptions?: HonchoMiddlewareOptions
) {
  return {
    transformParams: async ({ params }: { params: any }) => {
      const callOptions = (params.providerOptions?.honcho ?? {}) as HonchoCallOptions;
      const config = resolveConfig(
        client,
        providerOptions,
        callOptions,
        middlewareOptions
      );

      if (!config.injectContext || !config.peerId) {
        return params;
      }

      const contextData = await fetchContext(config);
      const contextText = config.formatContext(contextData);

      if (!contextText) return params;

      // Inject into system prompt
      const prompt = params.prompt ?? [];
      const systemIdx = prompt.findIndex(
        (m: any) => m.role === "system"
      );

      if (systemIdx >= 0) {
        const existing = prompt[systemIdx];
        const existingContent =
          typeof existing.content === "string"
            ? existing.content
            : Array.isArray(existing.content)
              ? existing.content
                  .filter((p: any) => p.type === "text")
                  .map((p: any) => p.text)
                  .join("")
              : "";

        const updatedPrompt = [...prompt];
        updatedPrompt[systemIdx] = {
          ...existing,
          content: `${existingContent}\n\n${contextText}`,
        };
        return { ...params, prompt: updatedPrompt };
      }

      return {
        ...params,
        prompt: [{ role: "system", content: contextText }, ...prompt],
      };
    },

    wrapGenerate: async ({
      doGenerate,
      params,
    }: {
      doGenerate: () => Promise<any>;
      params: any;
    }) => {
      const result = await doGenerate();

      const callOptions = (params.providerOptions?.honcho ?? {}) as HonchoCallOptions;
      const config = resolveConfig(
        client,
        providerOptions,
        callOptions,
        middlewareOptions
      );

      if (config.persistMessages && config.sessionId && config.peerId) {
        // Extract user message from prompt
        const prompt = params.prompt ?? [];
        const lastUserMsg = [...prompt]
          .reverse()
          .find((m: any) => m.role === "user");

        const userContent = extractTextContent(lastUserMsg);
        const assistantContent =
          typeof result.text === "string" ? result.text : "";

        const msgs: Array<{ role: string; content: string }> = [];
        if (userContent) msgs.push({ role: "user", content: userContent });
        if (assistantContent)
          msgs.push({ role: "assistant", content: assistantContent });

        if (msgs.length > 0) {
          // Fire and forget -- don't block the response
          persistMessages(config, msgs).catch(() => {});
        }
      }

      return result;
    },

    wrapStream: async ({
      doStream,
      params,
    }: {
      doStream: () => Promise<any>;
      params: any;
    }) => {
      const result = await doStream();

      const callOptions = (params.providerOptions?.honcho ?? {}) as HonchoCallOptions;
      const config = resolveConfig(
        client,
        providerOptions,
        callOptions,
        middlewareOptions
      );

      if (!config.persistMessages || !config.sessionId || !config.peerId) {
        return result;
      }

      // Collect streamed text and persist on finish
      const prompt = params.prompt ?? [];
      const lastUserMsg = [...prompt]
        .reverse()
        .find((m: any) => m.role === "user");
      const userContent = extractTextContent(lastUserMsg);

      let assistantText = "";

      const originalStream = result.stream;
      const transform = new TransformStream({
        transform(chunk, controller) {
          if (
            chunk.type === "text-delta" &&
            typeof chunk.textDelta === "string"
          ) {
            assistantText += chunk.textDelta;
          }
          controller.enqueue(chunk);
        },
        flush() {
          const msgs: Array<{ role: string; content: string }> = [];
          if (userContent) msgs.push({ role: "user", content: userContent });
          if (assistantText)
            msgs.push({ role: "assistant", content: assistantText });

          if (msgs.length > 0) {
            persistMessages(config, msgs).catch(() => {});
          }
        },
      });

      return {
        ...result,
        stream: originalStream.pipeThrough(transform),
      };
    },
  };
}

/**
 * Extract text content from a message object (handles both string and parts array).
 */
function extractTextContent(message: any): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter((p: any) => p.type === "text")
      .map((p: any) => p.text)
      .join("");
  }
  return "";
}
