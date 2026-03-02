# @honcho/ai-sdk

Honcho memory integration for the Vercel AI SDK.

`@honcho/ai-sdk` adds persistent memory and user modeling to any AI SDK model provider using:

- Session-aware middleware for context injection + message persistence
- Tool calling for memory retrieval and reasoning
- Submodules for OpenAI-format tools, Mastra tools, multi-agent memory, dreaming, and identity cards

## Install

```bash
npm install @honcho/ai-sdk
```

## Quick Start

```ts
import { createHoncho } from "@honcho/ai-sdk";
import { wrapLanguageModel, generateText } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

const honcho = createHoncho({
  workspaceId: process.env.HONCHO_WORKSPACE_ID!,
  // apiKey defaults to process.env.HONCHO_API_KEY
});

const session = honcho.session("session-123", {
  user: "user-abc",
  assistant: "assistant-xyz",
});

const model = wrapLanguageModel({
  model: anthropic("claude-sonnet-4-20250514"),
  middleware: session.middleware(),
});

const { text } = await generateText({
  model,
  tools: session.tools(),
  prompt: "What have you learned about me?",
});
```

## Multi-Peer Context

Use the multi-agent module when multiple peers should model each other:

```ts
import { createMultiAgentSession, multiAgentMiddleware } from "@honcho/ai-sdk/multi-agent";

const group = await createMultiAgentSession({
  provider: { workspaceId: process.env.HONCHO_WORKSPACE_ID! },
  sessionId: "group-chat-1",
  peers: [
    { peerId: "user-alice", observeMe: true, observeOthers: false },
    { peerId: "agent-bob", observeMe: false, observeOthers: true },
    { peerId: "agent-charlie", observeMe: false, observeOthers: true },
  ],
  context: {
    includeMessages: true,
    maxMessagesPerPeer: 8,
    contextTokensPerPeer: 2048,
    includeSummary: true,
  },
});

const middleware = multiAgentMiddleware(group, "agent-bob");
```

Multi-peer context includes representation/card plus bounded recent message replay per target peer.

## API Surface

- Root import: `@honcho/ai-sdk`
  - `createHoncho(...)` (primary API)
- Subpath imports:
  - `@honcho/ai-sdk/ai-sdk`
  - `@honcho/ai-sdk/openai`
  - `@honcho/ai-sdk/mastra`
  - `@honcho/ai-sdk/multi-agent`
  - `@honcho/ai-sdk/dreaming`
  - `@honcho/ai-sdk/identity`

## Notes

- Requires `ai@^6` and Node.js `>=18`.

## Development

```bash
npm run typecheck
npm run build
```

## License

Apache-2.0
