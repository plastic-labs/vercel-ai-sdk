import type Honcho from "@honcho-ai/core";
import type {
  HonchoSessionPeers,
  HonchoSessionOptions,
  HonchoContextData,
  PeerRoleMap,
  ResolvedSessionConfig,
} from "../types.js";
import { DEFAULTS } from "../shared/descriptions.js";
import { defaultFormatContext, fetchSessionContext, persistSessionMessages } from "../shared/context.js";
import { contextToSystemPrompt } from "../shared/converters.js";
import { honchoTools } from "./tools.js";
import type { HonchoToolsConfig } from "./tools.js";

/**
 * A session handle that manages dual-peer identity and provides
 * correctly-attributed middleware and tools.
 */
export interface HonchoSession {
  /** The session identifier. */
  readonly sessionId: string;
  /** The user peer identifier. */
  readonly userPeerId: string;
  /** The assistant peer identifier. */
  readonly assistantPeerId: string;
  /** Peer role map for converters. */
  readonly peerMap: PeerRoleMap;

  /**
   * Lazily ensure the session and both peers exist on the backend.
   * Idempotent -- subsequent calls return the same cached Promise.
   */
  ensure(): Promise<void>;

  /**
   * Create AI SDK middleware with correct dual-peer attribution.
   * Automatically calls ensure() on first use.
   */
  middleware(overrides?: Partial<HonchoSessionOptions>): ReturnType<typeof createSessionMiddleware>;

  /**
   * Create tools pre-bound to this session's peers.
   */
  tools(overrides?: Partial<HonchoToolsConfig>): ReturnType<typeof honchoTools>;
}

/**
 * Create a session handle. Synchronous -- captures config without making API calls.
 * Call ensure() or use middleware/tools to lazily initialize the backend resources.
 */
export function createSession(
  client: Honcho,
  workspaceId: string,
  sessionId: string,
  peers: HonchoSessionPeers,
  options?: HonchoSessionOptions
): HonchoSession {
  const peerMap: PeerRoleMap = {
    userPeerId: peers.user,
    assistantPeerId: peers.assistant,
  };

  const formatContext = options?.context?.format ?? defaultFormatContext;
  const onPersistenceError = options?.persistence?.onError ?? ((err) => console.warn("[honcho] persistence error:", err));

  const resolvedConfig: ResolvedSessionConfig = {
    client,
    workspaceId,
    sessionId,
    userPeerId: peers.user,
    assistantPeerId: peers.assistant,
    injectContext: true,
    persistMessages: options?.persistence?.enabled ?? true,
    contextTokens: options?.context?.tokens ?? DEFAULTS.contextTokens,
    includeSummary: options?.context?.includeSummary ?? true,
    formatContext,
    onPersistenceError,
  };

  let ensurePromise: Promise<void> | null = null;

  async function doEnsure(): Promise<void> {
    // getOrCreate session
    await client.workspaces.sessions.getOrCreate(workspaceId, {
      id: sessionId,
      ...options?.sessionConfig,
    });

    // getOrCreate user peer -- observes self (user's messages are observed)
    await client.workspaces.peers.getOrCreate(workspaceId, {
      id: peers.user,
      configuration: { observe_me: true },
    });

    // getOrCreate assistant peer -- observes others (sees user's messages)
    await client.workspaces.peers.getOrCreate(workspaceId, {
      id: peers.assistant,
      configuration: { observe_me: false, observe_others: true },
    });
  }

  function ensure(): Promise<void> {
    if (!ensurePromise) {
      ensurePromise = doEnsure();
    }
    return ensurePromise;
  }

  return {
    sessionId,
    userPeerId: peers.user,
    assistantPeerId: peers.assistant,
    peerMap,

    ensure,

    middleware(overrides?: Partial<HonchoSessionOptions>) {
      const config = overrides ? mergeConfig(resolvedConfig, overrides) : resolvedConfig;
      return createSessionMiddleware(config, peerMap, ensure);
    },

    tools(overrides?: Partial<HonchoToolsConfig>) {
      return honchoTools({
        client,
        workspaceId,
        defaultPeerId: peers.user,
        defaultObserverPeerId: peers.assistant,
        defaultSessionId: sessionId,
        ...overrides,
      });
    },
  };
}

/**
 * Merge session option overrides into a resolved config.
 */
function mergeConfig(
  base: ResolvedSessionConfig,
  overrides: Partial<HonchoSessionOptions>
): ResolvedSessionConfig {
  return {
    ...base,
    persistMessages: overrides.persistence?.enabled ?? base.persistMessages,
    contextTokens: overrides.context?.tokens ?? base.contextTokens,
    includeSummary: overrides.context?.includeSummary ?? base.includeSummary,
    formatContext: overrides.context?.format ?? base.formatContext,
    onPersistenceError: overrides.persistence?.onError ?? base.onPersistenceError,
  };
}

/**
 * Detect whether this is a continuation step (tool-result follow-up)
 * by checking if the prompt contains tool-result messages.
 */
function isToolContinuation(prompt: any[]): boolean {
  return prompt.some((m: any) => m.role === "tool");
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

/**
 * Create AI SDK middleware with session-aware dual-peer attribution.
 */
export function createSessionMiddleware(
  config: ResolvedSessionConfig,
  peerMap: PeerRoleMap,
  ensure: () => Promise<void>
) {
  return {
    transformParams: async ({ params }: { params: any }) => {
      await ensure();

      if (!config.injectContext) return params;

      const contextData = await fetchSessionContext(config);
      const contextText = contextToSystemPrompt(contextData, peerMap);

      if (!contextText) return params;

      // Inject into system prompt
      const prompt = params.prompt ?? [];
      const systemIdx = prompt.findIndex((m: any) => m.role === "system");

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

      if (!config.persistMessages) return result;

      const prompt = params.prompt ?? [];

      // Only persist user message on the first step, not tool continuations
      const isFirstStep = !isToolContinuation(prompt);

      const msgs: Array<{ role: string; content: string }> = [];

      if (isFirstStep) {
        const lastUserMsg = [...prompt]
          .reverse()
          .find((m: any) => m.role === "user");
        const userContent = extractTextContent(lastUserMsg);
        if (userContent) msgs.push({ role: "user", content: userContent });
      }

      const assistantContent =
        typeof result.text === "string" ? result.text : "";
      if (assistantContent) {
        msgs.push({ role: "assistant", content: assistantContent });
      }

      if (msgs.length > 0) {
        persistSessionMessages(config, msgs).catch(config.onPersistenceError);
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

      if (!config.persistMessages) return result;

      const prompt = params.prompt ?? [];
      const isFirstStep = !isToolContinuation(prompt);

      let userContent = "";
      if (isFirstStep) {
        const lastUserMsg = [...prompt]
          .reverse()
          .find((m: any) => m.role === "user");
        userContent = extractTextContent(lastUserMsg);
      }

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
            persistSessionMessages(config, msgs).catch(config.onPersistenceError);
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
