import type {
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Middleware,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";
import { SessionContext } from "@honcho-ai/sdk";
import type { MessageInput, Peer, Session } from "@honcho-ai/sdk";
import type { HonchoMiddlewareConfig } from "../types.js";

export interface ResolvedMiddlewareConfig {
  userId: string;
  sessionId?: string;
  assistantId: string;
  persistInput: boolean;
  injectHistory: boolean;
  formatContext?: (context: SessionContext) => string;
  onError: (error: unknown) => void;
}

export interface MiddlewareResources {
  userPeer: Peer;
  assistantPeer?: Peer;
  session?: Session;
}

export interface MiddlewareCreateOptions {
  config: ResolvedMiddlewareConfig;
  ensureResources: () => Promise<MiddlewareResources>;
}

/**
 * Build a single Honcho middleware with flat config.
 */
export function createMiddleware({
  config,
  ensureResources,
}: MiddlewareCreateOptions): LanguageModelV3Middleware {
  return {
    specificationVersion: "v3",

    transformParams: async ({ params }) => {
      try {
        const resources = await ensureResources();
        const context = resources.session
          ? await resources.session.context({
              peerPerspective: config.assistantId,
              peerTarget: config.userId,
              summary: true,
            })
          : await buildPeerOnlyContext(resources, config);

        const formattedContext = formatContext(context, config);
        if (!formattedContext) {
          return params;
        }

        return injectContextIntoSystemPrompt(params, formattedContext);
      } catch (error) {
        config.onError(error);
        return params;
      }
    },

    wrapGenerate: async ({ doGenerate, params }) => {
      const result = await doGenerate();

      if (!config.sessionId) {
        return result;
      }

      try {
        const { userPeer, assistantPeer, session } = await ensureResources();
        if (!assistantPeer || !session) {
          return result;
        }

        const prompt = (params.prompt ?? []) as LanguageModelV3Prompt;
        const messages: MessageInput[] = [];

        if (config.persistInput && !isToolContinuation(prompt)) {
          const userContent = extractLastUserMessage(prompt);
          if (userContent) {
            messages.push(userPeer.message(userContent));
          }
        }

        const output = extractGeneratedText(result);
        if (output) {
          messages.push(assistantPeer.message(output));
        }

        if (messages.length > 0) {
          await session.addMessages(messages);
        }
      } catch (error) {
        config.onError(error);
      }

      return result;
    },

    wrapStream: async ({ doStream, params }) => {
      const result = await doStream();

      if (!config.sessionId) {
        return result;
      }

      const prompt = (params.prompt ?? []) as LanguageModelV3Prompt;
      const shouldPersistInput = config.persistInput && !isToolContinuation(prompt);
      const userContent = shouldPersistInput ? extractLastUserMessage(prompt) : "";
      const resourcesPromise = ensureResources();

      let assistantText = "";
      let finishReason: string | undefined;
      let streamErrored = false;
      const stream = result.stream.pipeThrough(
        new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === "text-delta") {
              assistantText += chunk.delta;
            } else if (chunk.type === "finish") {
              finishReason = chunk.finishReason.unified;
            } else if (chunk.type === "error") {
              streamErrored = true;
            }
            controller.enqueue(chunk);
          },
          async flush() {
            if (streamErrored) {
              return;
            }
            if (
              finishReason &&
              finishReason !== "stop" &&
              finishReason !== "length" &&
              finishReason !== "tool-calls"
            ) {
              return;
            }

            try {
              const { userPeer, assistantPeer, session } = await resourcesPromise;
              if (!assistantPeer || !session) {
                return;
              }

              const messages: MessageInput[] = [];
              if (userContent) {
                messages.push(userPeer.message(userContent));
              }
              if (assistantText) {
                messages.push(assistantPeer.message(assistantText));
              }

              if (messages.length > 0) {
                await session.addMessages(messages);
              }
            } catch (error) {
              config.onError(error);
            }
          },
        })
      );

      return {
        ...result,
        stream,
      } as LanguageModelV3StreamResult;
    },
  };
}

function formatContext(
  context: SessionContext,
  config: ResolvedMiddlewareConfig
): string {
  const contextForFormatting = config.injectHistory
    ? context
    : new SessionContext(
        context.sessionId,
        [],
        context.summary,
        context.peerRepresentation,
        context.peerCard
      );

  if (config.formatContext) {
    return config.formatContext(contextForFormatting).trim();
  }

  return defaultFormatContext(contextForFormatting, config);
}

function defaultFormatContext(
  context: SessionContext,
  config: Pick<ResolvedMiddlewareConfig, "assistantId" | "injectHistory" | "userId">
): string {
  const sections: string[] = [];

  if (context.peerRepresentation) {
    sections.push(
      `<honcho_user_context>\n${context.peerRepresentation}\n</honcho_user_context>`
    );
  }

  if (context.peerCard && context.peerCard.length > 0) {
    const peerCardLines = context.peerCard.map((line) => `- ${line}`).join("\n");
    sections.push(`<honcho_user_card>\n${peerCardLines}\n</honcho_user_card>`);
  }

  if (context.summary?.content) {
    sections.push(
      `<honcho_session_summary>\n${context.summary.content}\n</honcho_session_summary>`
    );
  }

  if (config.injectHistory) {
    const openAIMessages = context
      .toOpenAI(config.assistantId)
      .filter((message) => message.role !== "system");

    if (openAIMessages.length > 0) {
      const historyLines = openAIMessages.map((message) => {
        const senderId = message.name;
        if (message.role === "assistant") {
          return `[assistant]: ${message.content}`;
        }

        if (senderId && senderId !== config.userId) {
          return `[user (${senderId})]: ${message.content}`;
        }

        return `[user]: ${message.content}`;
      });

      sections.push(
        `<honcho_recent_messages>\n${historyLines.join("\n")}\n</honcho_recent_messages>`
      );
    }
  }

  return sections.join("\n\n").trim();
}

async function buildPeerOnlyContext(
  resources: MiddlewareResources,
  config: Pick<ResolvedMiddlewareConfig, "userId" | "assistantId">
): Promise<SessionContext> {
  const observerPeer = resources.assistantPeer ?? resources.userPeer;
  const peerContext =
    config.assistantId === config.userId
      ? await observerPeer.context()
      : await observerPeer.context({ target: config.userId });
  return new SessionContext(
    "peer-only",
    [],
    null,
    peerContext.representation,
    peerContext.peerCard
  );
}

function injectContextIntoSystemPrompt(
  params: LanguageModelV3CallOptions,
  contextText: string
): LanguageModelV3CallOptions {
  const prompt = [...(params.prompt ?? [])];
  const systemIndex = prompt.findIndex((message) => message.role === "system");

  if (systemIndex >= 0) {
    const systemMessage = prompt[systemIndex] as { role: "system"; content: string };

    prompt[systemIndex] = {
      ...systemMessage,
      content: systemMessage.content
        ? `${systemMessage.content}\n\n${contextText}`
        : contextText,
    };
  } else {
    prompt.unshift({ role: "system", content: contextText });
  }

  return {
    ...params,
    prompt,
  };
}

function isToolContinuation(prompt: LanguageModelV3Prompt): boolean {
  const lastNonSystem = [...prompt]
    .reverse()
    .find((message) => message.role !== "system");
  return lastNonSystem?.role === "tool";
}

function extractLastUserMessage(prompt: LanguageModelV3Prompt): string {
  const userMessage = [...prompt]
    .reverse()
    .find((message) => message.role === "user");

  if (!userMessage || userMessage.role !== "user") {
    return "";
  }

  return userMessage.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

function extractGeneratedText(result: LanguageModelV3GenerateResult): string {
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim();
}

export function resolveMiddlewareConfig(
  config: HonchoMiddlewareConfig
): ResolvedMiddlewareConfig {
  if (!config.userId || config.userId.trim().length === 0) {
    throw new Error("middleware() requires userId (or defaultUserId in createHoncho).");
  }

  const assistantId = (config.assistantId ?? "assistant").trim();
  if (!assistantId) {
    throw new Error("assistantId must be a non-empty string.");
  }

  return {
    userId: config.userId.trim(),
    sessionId: normalizeSessionId(config.sessionId),
    assistantId,
    persistInput: config.persistInput ?? true,
    injectHistory: config.injectHistory ?? true,
    formatContext: config.formatContext,
    onError:
      config.onError ??
      ((error) => console.warn("[honcho] middleware error:", error)),
  };
}

function normalizeSessionId(value: string | null | undefined): string | undefined {
  if (value == null) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
