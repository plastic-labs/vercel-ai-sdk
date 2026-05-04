export type {
  HonchoProviderOptions,
  HonchoMiddlewareConfig,
  HonchoToolsConfig,
  HonchoSendConfig,
} from "./types.js";

export { createHoncho } from "./provider/index.js";
export type { HonchoProvider } from "./provider/index.js";

export { TOOL_DESCRIPTIONS, PARAM_DESCRIPTIONS, DEFAULTS } from "./shared/descriptions.js";

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
