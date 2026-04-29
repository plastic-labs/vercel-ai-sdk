/**
 * Centralized tool descriptions and parameter descriptions.
 * Shared across all framework adapters for consistency.
 */

export const TOOL_DESCRIPTIONS = {
  chat: [
    "Ask a natural language question about the user based on their full",
    "interaction history. Uses dialectic reasoning to synthesize an answer",
    "from all available knowledge -- not just keyword matching, but actual",
    "inference about the user's preferences, patterns, and context.",
    "Use this when you need to understand something about the user that",
    "isn't directly stated in the current conversation.",
  ].join(" "),

  search: [
    "Search across stored conversation messages for a specific user.",
    "Returns relevant message excerpts ranked by semantic similarity.",
    "Use this to find specific past conversations, statements, or topics",
    "the user has discussed before.",
  ].join(" "),

  searchConclusions: [
    "Search derived conclusions and observations about the user.",
    "Conclusions are inferences that have been drawn from the user's",
    "interaction history -- personality traits, preferences, behavioral",
    "patterns, biographical facts. Use this to find specific known facts",
    "about the user.",
  ].join(" "),

  getRepresentation: [
    "Get a comprehensive representation of what is known about the user.",
    "Returns a synthesized profile combining conclusions, observations,",
    "and inferences. Use this when you need a holistic understanding",
    "of the user, not just specific facts.",
  ].join(" "),

  saveConclusion: [
    "Save an important observation or conclusion about the user.",
    "This creates a persistent derived fact that will be available",
    "in future interactions. Use this when you discover something",
    "significant about the user that should be remembered across sessions.",
  ].join(" "),

  getContext: [
    "Get combined session and peer context from Honcho, including",
    "recent messages, summaries, peer representation, and peer card.",
    "Use this when you need full conversational context for the current",
    "session and user.",
  ].join(" "),
} as const;

export const PARAM_DESCRIPTIONS = {
  query: "The natural language query or question to ask",
  peerId: "The peer (user) ID to query about",
  sessionId: "The session ID to scope the query to",
  observerId: "The peer ID acting as the observer perspective",
  limit: "Maximum number of results to return",
  content: "The conclusion or observation text to save",
  observedId: "The peer ID this conclusion is about",
  targetPeerId: "Optional peer whose perspective to use",
  includeFrequent: "Include most frequently referenced conclusions",
  maxConclusions: "Maximum number of conclusions to include",
  contextTokens: "Maximum token budget for context retrieval",
  includeSummary: "Whether to include a session summary in context",
  messageLimit: "Maximum number of recent messages to return",
} as const;

export const DEFAULTS = {
  assistantPeerId: "assistant",
  searchLimit: 10,
  conclusionTopK: 10,
  maxConclusions: 20,
  contextTokens: 4096,
  contextMessageLimit: 8,
} as const;
