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
  let generatedUserId: string | undefined;
  let generatedSessionId: string | undefined;
  let hasWarnedGeneratedUserId = false;
  let hasWarnedGeneratedSessionId = false;

  const providerDefaults: ProviderDefaults = {
    userId:
      options.defaultUserId != null
        ? normalizeRequiredId("defaultUserId", options.defaultUserId)
        : undefined,
    assistantId: normalizeRequiredId(
      "defaultAssistantId",
      options.defaultAssistantId ?? DEFAULTS.assistantPeerId
    ),
    sessionId:
      options.defaultSessionId != null
        ? normalizeRequiredId("defaultSessionId", options.defaultSessionId)
        : undefined,
  };

  const getCacheKey = ({ userId, assistantId, sessionId }: CacheKeyConfig): string =>
    JSON.stringify([assistantId, userId, sessionId ?? null]);

  const getEntry = (key: string): CacheEntry => {
    const existing = cache.get(key);
    if (existing) {
      return existing;
    }
    const created: CacheEntry = {};
    cache.set(key, created);
    return created;
  };

  const getGeneratedUserId = (): string => {
    generatedUserId ??= createGeneratedId("user");
    if (!hasWarnedGeneratedUserId) {
      console.warn(
        `[honcho] No userId provided. Using generated userId "${generatedUserId}". This is best suited to local or single-user flows. If one provider instance serves multiple users, pass userId/defaultUserId explicitly so requests do not share memory.`
      );
      hasWarnedGeneratedUserId = true;
    }
    return generatedUserId;
  };

  const getGeneratedSessionId = (): string => {
    generatedSessionId ??= createGeneratedId("session");
    if (!hasWarnedGeneratedSessionId) {
      console.warn(
        `[honcho] No sessionId provided. Using generated sessionId "${generatedSessionId}". This is best suited to local or single-thread flows. If one provider instance serves many conversations, pass sessionId/defaultSessionId explicitly to avoid sharing a thread, or pass sessionId: null to disable session mode.`
      );
      hasWarnedGeneratedSessionId = true;
    }
    return generatedSessionId;
  };

  const resolveUserId = (value: string | undefined): string => {
    if (value != null) {
      return normalizeRequiredId("userId", value);
    }

    if (providerDefaults.userId) {
      return providerDefaults.userId;
    }

    return getGeneratedUserId();
  };

  const resolveSessionId = (
    value: string | null | undefined
  ): string | undefined => {
    if (value === null) {
      return undefined;
    }

    if (value !== undefined) {
      return normalizeRequiredId("sessionId", value);
    }

    if (providerDefaults.sessionId) {
      return providerDefaults.sessionId;
    }

    return getGeneratedSessionId();
  };

  const resolveCacheKeyConfig = (
    config?: {
      userId?: string;
      assistantId?: string;
      sessionId?: string | null;
    }
  ): CacheKeyConfig => ({
      userId: resolveUserId(config?.userId),
      assistantId: normalizeRequiredId(
        "assistantId",
        config?.assistantId ?? providerDefaults.assistantId
      ),
      sessionId: resolveSessionId(config?.sessionId),
    });

  const cachePromise = <T>(
    factory: () => Promise<T>,
    reset: () => void
  ): Promise<T> => {
    const promise = factory().catch((error) => {
      reset();
      throw error;
    });
    return promise;
  };

  const ensureResources = async (
    config: CacheKeyConfig,
    requirements: { assistant: boolean; session: boolean }
  ): Promise<MiddlewareResources> => {
    const key = getCacheKey(config);
    const entry = getEntry(key);

    const userPeerPromise = (entry.userPeerPromise ??= cachePromise(
      () =>
        client.peer(config.userId, {
          configuration: { observeMe: true },
        }),
      () => {
        entry.userPeerPromise = undefined;
      }
    ));

    const needsAssistant = requirements.assistant || Boolean(config.sessionId);
    let assistantPeerPromise: Promise<Peer> | undefined;
    if (needsAssistant) {
      if (config.assistantId === config.userId) {
        entry.assistantPeerPromise = userPeerPromise;
        assistantPeerPromise = userPeerPromise;
      } else {
        assistantPeerPromise = entry.assistantPeerPromise ??= cachePromise(
          () =>
            client.peer(config.assistantId, {
              configuration: { observeMe: false },
            }),
          () => {
            entry.assistantPeerPromise = undefined;
          }
        );
      }
    }

    let sessionPromise: Promise<Session> | undefined;
    if (config.sessionId) {
      sessionPromise = entry.sessionPromise ??= cachePromise(
        () => client.session(config.sessionId!),
        () => {
          entry.sessionPromise = undefined;
        }
      );
    }

    if (config.sessionId && requirements.session) {
      const setupPromise = (entry.sessionSetupPromise ??= (async () => {
        const session = await sessionPromise!;
        const userPeer = await userPeerPromise;
        const assistantPeer = await assistantPeerPromise!;

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
      }));

      await setupPromise;
    }

    return {
      userPeer: await userPeerPromise,
      assistantPeer: assistantPeerPromise ? await assistantPeerPromise : undefined,
      session: sessionPromise ? await sessionPromise : undefined,
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
            assistant: true,
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

    send: async ({ userId, sessionId, assistantId, content }: HonchoSendConfig) => {
      const resolved = resolveCacheKeyConfig({ userId, assistantId, sessionId });

      if (!resolved.sessionId) {
        throw new Error("send() requires session mode. Omit sessionId to auto-generate, or pass a concrete value.");
      }

      const resources = await ensureResources(resolved, {
        assistant: false,
        session: true,
      });
      const { userPeer, session } = resources;
      if (!session) {
        throw new Error("send() failed to resolve session.");
      }

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

function createGeneratedId(prefix: "user" | "session"): string {
  const fromCrypto = globalThis.crypto?.randomUUID?.();
  const suffix =
    typeof fromCrypto === "string"
      ? fromCrypto.split("-")[0]
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}-${suffix}`;
}
