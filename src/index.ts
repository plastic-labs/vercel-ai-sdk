export type {
  HonchoProviderOptions,
  HonchoMiddlewareConfig,
  HonchoToolsConfig,
  HonchoSendConfig,
} from "./types.js";

// Primary API -- re-export from ai-sdk so users can import from "@honcho/ai-sdk" directly
export { createHoncho } from "./ai-sdk/index.js";
export type { HonchoProvider } from "./ai-sdk/index.js";

export { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "./shared/descriptions.js";

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
