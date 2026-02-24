import type Honcho from "@honcho-ai/core";
import { createClient, defaultFormatContext, fetchContext } from "../shared/context.js";
import type { HonchoProviderOptions, HonchoContextData } from "../types.js";

/**
 * Configuration for a peer in a multi-agent session.
 */
export interface AgentPeerConfig {
  /** Peer ID for this agent. */
  peerId: string;
  /** Whether Honcho should observe this peer's messages and build a representation. */
  observeMe?: boolean;
  /** Whether this peer should form theory-of-mind representations of other peers. */
  observeOthers?: boolean;
}

/**
 * Options for creating a multi-agent session.
 */
export interface MultiAgentSessionOptions {
  /** Honcho provider options (or an existing Honcho client). */
  provider: HonchoProviderOptions;
  /** Session ID. */
  sessionId: string;
  /** Peer configurations. At least 2 peers required. */
  peers: AgentPeerConfig[];
  /** Optional session-level configuration overrides. */
  sessionConfig?: {
    dream?: { enabled?: boolean };
    reasoning?: { enabled?: boolean; custom_instructions?: string };
    summary?: { enabled?: boolean };
  };
}

/**
 * A multi-agent session where multiple peers observe each other.
 *
 * This is Honcho's unique capability -- agents building theory-of-mind
 * representations of each other, not just of the user.
 *
 * @example
 * ```ts
 * const session = await createMultiAgentSession({
 *   provider: { workspaceId: "ws-1" },
 *   sessionId: "group-chat-1",
 *   peers: [
 *     { peerId: "user-alice", observeMe: true, observeOthers: false },
 *     { peerId: "agent-narrator", observeMe: false, observeOthers: true },
 *     { peerId: "agent-critic", observeMe: false, observeOthers: true },
 *   ],
 * });
 *
 * // Get what agent-narrator thinks about user-alice
 * const perspective = await session.getPeerPerspective("agent-narrator", "user-alice");
 *
 * // Get cross-peer context for agent-narrator (includes views of all other peers)
 * const context = await session.getCrossPeerContext("agent-narrator");
 *
 * // Send a message as a specific peer
 * await session.sendMessage("user-alice", "I think the story should go darker here.");
 * ```
 */
export interface MultiAgentSession {
  /** The workspace ID. */
  workspaceId: string;
  /** The session ID. */
  sessionId: string;
  /** Peer IDs in this session. */
  peerIds: string[];
  /** The Honcho client. */
  client: Honcho;

  /**
   * Get one peer's representation of another peer.
   * Theory-of-mind: what does observer think about target?
   */
  getPeerPerspective(
    observerPeerId: string,
    targetPeerId: string
  ): Promise<{ representation: string; card: string[] | null }>;

  /**
   * Get combined context for a peer, including their views of all other peers.
   * Returns a map of targetPeerId -> representation.
   */
  getCrossPeerContext(
    peerId: string
  ): Promise<Map<string, HonchoContextData>>;

  /**
   * Get a formatted context string for a peer, suitable for system prompt injection.
   * Includes this peer's views of all other peers in the session.
   */
  getFormattedContext(
    peerId: string,
    formatter?: (peerContexts: Map<string, HonchoContextData>) => string
  ): Promise<string>;

  /**
   * Send a message to the session as a specific peer.
   */
  sendMessage(peerId: string, content: string): Promise<void>;

  /**
   * Send multiple messages from multiple peers at once.
   */
  sendMessages(
    messages: Array<{ peerId: string; content: string }>
  ): Promise<void>;

  /**
   * Trigger the dialectic API from one peer's perspective about another.
   */
  askAboutPeer(
    observerPeerId: string,
    targetPeerId: string,
    query: string
  ): Promise<string>;

  /**
   * Schedule a dream to consolidate one peer's observations of another.
   */
  scheduleDream(
    observerPeerId: string,
    observedPeerId: string
  ): Promise<void>;
}

/**
 * Create a multi-agent session with cross-peer observation.
 *
 * Sets up peers with their observation configs and returns a session
 * handle with methods for cross-peer queries.
 */
export async function createMultiAgentSession(
  options: MultiAgentSessionOptions
): Promise<MultiAgentSession> {
  const { provider, sessionId, peers, sessionConfig } = options;
  const client = createClient(provider);
  const workspaceId = provider.workspaceId;

  // Ensure workspace exists
  await client.workspaces.getOrCreate({ id: workspaceId });

  // Build peer config map
  const peerConfigMap: Record<string, { observe_me?: boolean; observe_others?: boolean }> = {};
  for (const peer of peers) {
    peerConfigMap[peer.peerId] = {
      observe_me: peer.observeMe ?? true,
      observe_others: peer.observeOthers ?? false,
    };
  }

  // Create session with all peers
  await client.workspaces.sessions.getOrCreate(workspaceId, {
    id: sessionId,
    peers: peerConfigMap,
    configuration: sessionConfig ?? undefined,
  });

  const peerIds = peers.map((p) => p.peerId);

  const session: MultiAgentSession = {
    workspaceId,
    sessionId,
    peerIds,
    client,

    async getPeerPerspective(observerPeerId, targetPeerId) {
      const [rep, card] = await Promise.all([
        client.workspaces.peers
          .representation(workspaceId, observerPeerId, {
            target: targetPeerId,
            session_id: sessionId,
          })
          .catch(() => ({ representation: "" })),
        client.workspaces.peers
          .card(workspaceId, observerPeerId, { target: targetPeerId })
          .catch(() => ({ peer_card: null })),
      ]);

      return {
        representation: rep.representation,
        card: card.peer_card ?? null,
      };
    },

    async getCrossPeerContext(peerId) {
      const otherPeers = peerIds.filter((id) => id !== peerId);
      const contextMap = new Map<string, HonchoContextData>();

      const results = await Promise.all(
        otherPeers.map(async (targetId) => {
          const perspective = await session.getPeerPerspective(peerId, targetId);
          return {
            targetId,
            data: {
              representation: perspective.representation || null,
              peerCard: perspective.card,
              summary: null,
              messages: undefined,
            } as HonchoContextData,
          };
        })
      );

      for (const { targetId, data } of results) {
        contextMap.set(targetId, data);
      }

      return contextMap;
    },

    async getFormattedContext(peerId, formatter) {
      const contexts = await session.getCrossPeerContext(peerId);

      if (formatter) return formatter(contexts);

      // Default formatter: structured XML blocks per peer
      const sections: string[] = [];
      for (const [targetId, data] of contexts) {
        const inner = defaultFormatContext(data);
        if (inner) {
          sections.push(
            `<honcho_peer_view target="${targetId}">\n${inner}\n</honcho_peer_view>`
          );
        }
      }

      return sections.length > 0
        ? `<honcho_multi_agent_context>\n${sections.join("\n\n")}\n</honcho_multi_agent_context>`
        : "";
    },

    async sendMessage(peerId, content) {
      await client.workspaces.sessions.messages.create(
        workspaceId,
        sessionId,
        { messages: [{ content, peer_id: peerId }] }
      );
    },

    async sendMessages(messages) {
      await client.workspaces.sessions.messages.create(
        workspaceId,
        sessionId,
        {
          messages: messages.map((m) => ({
            content: m.content,
            peer_id: m.peerId,
          })),
        }
      );
    },

    async askAboutPeer(observerPeerId, targetPeerId, query) {
      const response = await client.workspaces.peers.chat(
        workspaceId,
        observerPeerId,
        {
          query,
          target: targetPeerId,
          session_id: sessionId,
        }
      );
      return response.content;
    },

    async scheduleDream(observerPeerId, observedPeerId) {
      await client.workspaces.scheduleDream(workspaceId, {
        dream_type: "omni",
        observer: observerPeerId,
        observed: observedPeerId,
        session_id: sessionId,
      });
    },
  };

  return session;
}

/**
 * Create Vercel AI SDK middleware for a specific peer in a multi-agent session.
 * Injects cross-peer context and persists messages under the peer's identity.
 */
export function multiAgentMiddleware(
  session: MultiAgentSession,
  peerId: string
) {
  return {
    transformParams: async ({ params }: { params: any }) => {
      const contextText = await session.getFormattedContext(peerId);
      if (!contextText) return params;

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

      const assistantText =
        typeof result.text === "string" ? result.text : "";

      if (assistantText) {
        session.sendMessage(peerId, assistantText).catch(() => {});
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
      let collected = "";

      const transform = new TransformStream({
        transform(chunk, controller) {
          if (chunk.type === "text-delta" && typeof chunk.textDelta === "string") {
            collected += chunk.textDelta;
          }
          controller.enqueue(chunk);
        },
        flush() {
          if (collected) {
            session.sendMessage(peerId, collected).catch(() => {});
          }
        },
      });

      return { ...result, stream: result.stream.pipeThrough(transform) };
    },
  };
}
