export type {
  HonchoProviderOptions,
  HonchoCallOptions,
  HonchoMiddlewareOptions,
  HonchoContextData,
  ResolvedHonchoConfig,
} from "./types.js";

export { defaultFormatContext } from "./shared/context.js";
export { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "./shared/descriptions.js";

// Frontier modules
export { createMultiAgentSession, multiAgentMiddleware } from "./multi-agent/index.js";
export type {
  AgentPeerConfig,
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
