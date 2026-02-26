import Honcho from "@honcho-ai/core";
import type {
  HonchoProviderOptions,
  HonchoCallOptions,
  HonchoContextData,
  HonchoMiddlewareOptions,
  ResolvedHonchoConfig,
  ResolvedSessionConfig,
} from "../types.js";

/**
 * Custom fetch that rewrites /v2/ paths to /v3/ to bridge the SDK v2
 * client against the production v3 API until a v3 SDK is published.
 */
function v3Fetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
  const urlStr = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
  const rewritten = urlStr.replace("/v2/", "/v3/");
  return globalThis.fetch(rewritten, init);
}

/**
 * Create a Honcho client from provider options.
 */
export function createClient(options: HonchoProviderOptions): Honcho {
  const clientOptions: ConstructorParameters<typeof Honcho>[0] = {
    apiKey: options.apiKey ?? process.env.HONCHO_API_KEY ?? null,
    fetch: v3Fetch,
  };

  if (options.baseURL) {
    clientOptions.baseURL = options.baseURL;
  } else if (options.environment) {
    clientOptions.environment = options.environment;
  }

  return new Honcho(clientOptions);
}

/**
 * Default context formatter. Produces a structured XML-like block
 * for injection into system prompts.
 */
export function defaultFormatContext(data: HonchoContextData): string {
  const sections: string[] = [];

  if (data.representation) {
    sections.push(
      `<honcho_user_context>\n${data.representation}\n</honcho_user_context>`
    );
  }

  if (data.peerCard && data.peerCard.length > 0) {
    const cardText = data.peerCard.map((entry) => `- ${entry}`).join("\n");
    sections.push(`<honcho_user_card>\n${cardText}\n</honcho_user_card>`);
  }

  if (data.summary) {
    sections.push(
      `<honcho_session_summary>\n${data.summary}\n</honcho_session_summary>`
    );
  }

  return sections.join("\n\n");
}

/**
 * Resolve provider + call options + middleware options into a single config.
 */
export function resolveConfig(
  client: Honcho,
  providerOptions: HonchoProviderOptions,
  callOptions?: HonchoCallOptions,
  middlewareOptions?: HonchoMiddlewareOptions
): ResolvedHonchoConfig {
  const peerId =
    callOptions?.peerId ?? providerOptions.defaultPeerId ?? "";
  const sessionId =
    callOptions?.sessionId ?? providerOptions.defaultSessionId;

  return {
    client,
    workspaceId: providerOptions.workspaceId,
    peerId,
    sessionId,
    targetPeerId: callOptions?.targetPeerId,
    injectContext:
      callOptions?.injectContext ??
      middlewareOptions?.injectContext ??
      true,
    persistMessages:
      callOptions?.persistMessages ??
      middlewareOptions?.persistMessages ??
      true,
    contextTokens: callOptions?.contextTokens,
    includeSummary: callOptions?.includeSummary ?? true,
    formatContext:
      middlewareOptions?.formatContext ?? defaultFormatContext,
  };
}

/**
 * Fetch context from Honcho for a given peer/session.
 * Uses session.context when a session ID is available,
 * falls back to peer.context otherwise.
 */
export async function fetchContext(
  config: ResolvedHonchoConfig
): Promise<HonchoContextData> {
  const { client, workspaceId, peerId, sessionId } = config;

  if (!peerId) {
    return {};
  }

  if (sessionId) {
    // peer_perspective requires peer_target -- only pass both or neither
    const hasPeerPair = peerId && config.targetPeerId;
    const ctx = await client.workspaces.sessions.context(
      workspaceId,
      sessionId,
      {
        peer_perspective: hasPeerPair ? peerId : undefined,
        peer_target: hasPeerPair ? config.targetPeerId : undefined,
        summary: config.includeSummary,
        tokens: config.contextTokens,
      }
    );

    return {
      representation: ctx.peer_representation ?? null,
      peerCard: ctx.peer_card ?? null,
      summary: ctx.summary?.content ?? null,
      messages: ctx.messages?.map((m) => ({
        content: m.content,
        peer_id: m.peer_id,
      })),
    };
  }

  // No session -- fetch peer context only
  const ctx = await client.workspaces.peers.context(workspaceId, peerId, {
    target: config.targetPeerId ?? undefined,
    max_conclusions: undefined,
  });

  return {
    representation: ctx.representation ?? null,
    peerCard: ctx.peer_card ?? null,
    summary: null,
    messages: undefined,
  };
}

/**
 * Persist user and assistant messages to a Honcho session.
 */
export async function persistMessages(
  config: ResolvedHonchoConfig,
  messages: Array<{ role: string; content: string; peerId?: string }>
): Promise<void> {
  const { client, workspaceId, sessionId, peerId } = config;

  if (!sessionId || !peerId) return;

  const honchoMessages = messages
    .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      content: m.content,
      peer_id: m.peerId ?? peerId,
    }));

  if (honchoMessages.length === 0) return;

  await client.workspaces.sessions.messages.create(workspaceId, sessionId, {
    messages: honchoMessages,
  });
}

// ── Session-aware functions ────────────────────────────────────

/**
 * Fetch context from Honcho using the session's dual-peer perspective.
 * Fetches from the assistant's perspective about the user.
 */
export async function fetchSessionContext(
  config: ResolvedSessionConfig
): Promise<HonchoContextData> {
  const { client, workspaceId, sessionId, userPeerId, assistantPeerId } = config;

  const ctx = await client.workspaces.sessions.context(
    workspaceId,
    sessionId,
    {
      peer_perspective: assistantPeerId,
      peer_target: userPeerId,
      summary: config.includeSummary,
      tokens: config.contextTokens,
    }
  );

  return {
    representation: ctx.peer_representation ?? null,
    peerCard: ctx.peer_card ?? null,
    summary: ctx.summary?.content ?? null,
    messages: ctx.messages?.map((m) => ({
      content: m.content,
      peer_id: m.peer_id,
    })),
  };
}

/**
 * Persist messages to a Honcho session with correct dual-peer attribution.
 * Maps role: "user" to userPeerId and role: "assistant" to assistantPeerId.
 */
export async function persistSessionMessages(
  config: ResolvedSessionConfig,
  messages: Array<{ role: string; content: string }>
): Promise<void> {
  const { client, workspaceId, sessionId, userPeerId, assistantPeerId } = config;

  const honchoMessages = messages
    .filter((m) => m.content && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({
      content: m.content,
      peer_id: m.role === "assistant" ? assistantPeerId : userPeerId,
    }));

  if (honchoMessages.length === 0) return;

  await client.workspaces.sessions.messages.create(workspaceId, sessionId, {
    messages: honchoMessages,
  });
}
