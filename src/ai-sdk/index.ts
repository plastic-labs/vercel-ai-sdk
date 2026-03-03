import type { Peer, Session } from "@honcho-ai/sdk";
import { DEFAULTS } from "../shared/descriptions.js";
import { createClient } from "../shared/context.js";
import {
  createMiddleware,
  resolveMiddlewareConfig,
  type MiddlewareResources,
} from "./middleware.js";
import {
  createTools,
  resolveToolsConfig,
  type ToolResources,
} from "./tools.js";
import type {
  HonchoMiddlewareConfig,
  HonchoProviderOptions,
  HonchoSendConfig,
  HonchoToolsConfig,
} from "../types.js";

/**
 * The Honcho provider object returned by createHoncho().
 */
export interface HonchoProvider {
  /** Create middleware with flat config. */
  middleware: (config?: HonchoMiddlewareConfig) => ReturnType<typeof createMiddleware>;
  /** Create tools spreadable into generateText/streamText. */
  tools: (config?: HonchoToolsConfig) => ReturnType<typeof createTools>;
  /** Persist one user message to a session. */
  send: (config: HonchoSendConfig) => Promise<void>;
  /** The underlying Honcho client for direct API access. */
  client: ReturnType<typeof createClient>;
}

interface CacheEntry {
  userPeerPromise?: Promise<Peer>;
  assistantPeerPromise?: Promise<Peer>;
  sessionPromise?: Promise<Session>;
  sessionSetupPromise?: Promise<void>;
}

interface CacheKeyConfig {
  userId: string;
  assistantId: string;
  sessionId?: string;
}

interface ProviderDefaults {
  userId?: string;
  assistantId: string;
  sessionId?: string;
}

export type { HonchoMiddlewareConfig, HonchoToolsConfig, HonchoSendConfig };

/**
 * Create a Honcho provider with flat middleware/tools APIs.
 */
export function createHoncho(options: HonchoProviderOptions = {}): HonchoProvider {
  const client = createClient(options);
  const cache = new Map<string, CacheEntry>();
  const usePlugAndPlayDefaults =
    options.allowDefaultWorkspace ||
    options.defaultUserId != null ||
    options.defaultSessionId != null ||
    options.defaultAssistantId != null;

  const providerDefaults: ProviderDefaults = {
    userId:
      options.defaultUserId != null
        ? normalizeRequiredId("defaultUserId", options.defaultUserId)
        : usePlugAndPlayDefaults
          ? "user"
          : undefined,
    assistantId: normalizeRequiredId(
      "defaultAssistantId",
      options.defaultAssistantId ?? DEFAULTS.assistantPeerId
    ),
    sessionId:
      options.defaultSessionId != null
        ? normalizeRequiredId("defaultSessionId", options.defaultSessionId)
        : usePlugAndPlayDefaults
          ? "session"
          : undefined,
  };

  const getCacheKey = ({ userId, assistantId, sessionId }: CacheKeyConfig): string =>
    `${assistantId}::${userId}::${sessionId ?? ""}`;

  const getEntry = (key: string): CacheEntry => {
    const existing = cache.get(key);
    if (existing) {
      return existing;
    }
    const created: CacheEntry = {};
    cache.set(key, created);
    return created;
  };

  const resolveSessionId = (
    value: string | null | undefined
  ): string | undefined => {
    if (value === null) return undefined;
    const candidate = value ?? providerDefaults.sessionId;
    if (!candidate) return undefined;
    const normalized = candidate.trim();
    return normalized.length > 0 ? normalized : undefined;
  };

  const resolveCacheKeyConfig = (
    config?: {
      userId?: string;
      assistantId?: string;
      sessionId?: string | null;
    }
  ): CacheKeyConfig => ({
    userId: normalizeRequiredId(
      "userId",
      config?.userId ?? providerDefaults.userId
    ),
    assistantId: normalizeRequiredId(
      "assistantId",
      config?.assistantId ?? providerDefaults.assistantId
    ),
    sessionId: resolveSessionId(config?.sessionId),
  });

  const ensureResources = async (
    config: CacheKeyConfig,
    requirements: { assistant: boolean; session: boolean }
  ): Promise<MiddlewareResources> => {
    const key = getCacheKey(config);
    const entry = getEntry(key);

    entry.userPeerPromise ??= client.peer(config.userId, {
      configuration: { observeMe: true },
    });

    const needsAssistant = requirements.assistant || Boolean(config.sessionId);
    if (needsAssistant) {
      if (config.assistantId === config.userId) {
        entry.assistantPeerPromise = entry.userPeerPromise;
      } else {
        entry.assistantPeerPromise ??= client.peer(config.assistantId, {
          configuration: { observeMe: false },
        });
      }
    }

    if (config.sessionId) {
      entry.sessionPromise ??= client.session(config.sessionId);
    }

    if (config.sessionId && requirements.session) {
      entry.sessionSetupPromise ??= (async () => {
        const session = await entry.sessionPromise!;
        const userPeer = await entry.userPeerPromise!;
        const assistantPeer = await entry.assistantPeerPromise!;

        if (config.userId === config.assistantId) {
          await session.addPeers([[userPeer, { observeMe: true, observeOthers: true }]]);
          return;
        }

        await session.addPeers([
          [userPeer, { observeMe: true, observeOthers: false }],
          [assistantPeer, { observeMe: false, observeOthers: true }],
        ]);
      })().catch((error) => {
        entry.sessionSetupPromise = undefined;
        throw error;
      });

      await entry.sessionSetupPromise;
    }

    return {
      userPeer: await entry.userPeerPromise,
      assistantPeer: entry.assistantPeerPromise
        ? await entry.assistantPeerPromise
        : undefined,
      session: entry.sessionPromise ? await entry.sessionPromise : undefined,
    };
  };

  return {
    middleware: (middlewareConfig: HonchoMiddlewareConfig = {}) => {
      const resolvedKeys = resolveCacheKeyConfig(middlewareConfig);
      const resolved = resolveMiddlewareConfig({
        ...middlewareConfig,
        userId: resolvedKeys.userId,
        assistantId: resolvedKeys.assistantId,
        sessionId: resolvedKeys.sessionId,
      });
      return createMiddleware({
        config: resolved,
        ensureResources: async () =>
          ensureResources(resolved, {
            assistant: Boolean(resolved.sessionId),
            session: Boolean(resolved.sessionId),
          }),
      });
    },

    tools: (toolsConfig: HonchoToolsConfig = {}) => {
      const resolvedKeys = resolveCacheKeyConfig(toolsConfig);
      const resolved = resolveToolsConfig({
        ...toolsConfig,
        userId: resolvedKeys.userId,
        assistantId: resolvedKeys.assistantId,
        sessionId: resolvedKeys.sessionId,
      });
      return createTools({
        config: resolved,
        ensureResources: async (): Promise<ToolResources> => {
          const resources = await ensureResources(resolved, {
            assistant: true,
            session: Boolean(resolved.sessionId),
          });
          if (!resources.assistantPeer) {
            throw new Error("Unable to resolve assistant peer.");
          }
          return {
            userPeer: resources.userPeer,
            assistantPeer: resources.assistantPeer,
            session: resources.session,
          };
        },
      });
    },

    send: async ({ userId, sessionId, content }: HonchoSendConfig) => {
      const resolved = resolveCacheKeyConfig({ userId, sessionId });
      if (!resolved.sessionId) {
        throw new Error("send() requires a sessionId (or defaultSessionId).");
      }

      const key = getCacheKey({
        userId: resolved.userId,
        assistantId: resolved.assistantId,
        sessionId: resolved.sessionId,
      });
      const entry = getEntry(key);

      entry.userPeerPromise ??= client.peer(resolved.userId, {
        configuration: { observeMe: true },
      });
      entry.sessionPromise ??= client.session(resolved.sessionId);

      const [userPeer, session] = await Promise.all([
        entry.userPeerPromise,
        entry.sessionPromise,
      ]);

      await session.addPeers([[userPeer, { observeMe: true, observeOthers: false }]]);
      await session.addMessages(userPeer.message(content));
    },

    client,
  };
}

function normalizeRequiredId(fieldName: string, value: string | undefined): string {
  if (value == null) {
    throw new Error(
      `${fieldName} is required. Provide it in the call config or set a provider default in createHoncho().`
    );
  }

  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return normalized;
}
