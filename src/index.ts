export type {
  HonchoProviderOptions,
  HonchoCallOptions,
  HonchoMiddlewareOptions,
  HonchoContextData,
  ResolvedHonchoConfig,
  HonchoSessionPeers,
  HonchoSessionOptions,
  PeerRoleMap,
  ResolvedSessionConfig,
} from "./types.js";

// Primary API -- re-export from ai-sdk so users can import from "@honcho/ai-sdk" directly
export { createHoncho } from "./ai-sdk/index.js";
export type { HonchoProvider, HonchoSession } from "./ai-sdk/index.js";

export { defaultFormatContext } from "./shared/context.js";
export { contextToSystemPrompt, contextToMessages } from "./shared/converters.js";
export { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "./shared/descriptions.js";

// Frontier modules
export { createMultiAgentSession, multiAgentMiddleware } from "./multi-agent/index.js";
export type {
  AgentPeerConfig,
  MultiAgentContextOptions,
  MultiAgentSessionOptions,
  MultiAgentSession,
} from "./multi-agent/index.js";

export { createDreamingAgent } from "./dreaming/index.js";
export type {
  DreamingAgentOptions,
  DreamingAgent,
  ReflectionResult,
  DreamStatus,
} from "./dreaming/index.js";

export {
  createPeerIdentity,
  createMultiPerspectiveIdentity,
  compareIdentityPerspectives,
} from "./identity/index.js";
export type {
  PeerIdentityOptions,
  PeerIdentity,
  CardDiff,
  CardSnapshot,
} from "./identity/index.js";
