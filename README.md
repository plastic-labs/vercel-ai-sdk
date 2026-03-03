# @honcho-ai/ai-sdk

Memory middleware and tools for the [Vercel AI SDK](https://sdk.vercel.ai), powered by [Honcho](https://honcho.dev).

## Install

```bash
npm install @honcho-ai/ai-sdk
```

Requires `ai@^6` and Node.js `>=18`.

## Environment

```bash
HONCHO_API_KEY=...
HONCHO_WORKSPACE_ID=...
```

`createHoncho()` reads API key/workspace from options and env.  
If workspace is missing in both, it implicitly falls back to `"vercel-ai-sdk"` (with a one-time warning).

Plug-and-play works with no explicit IDs. If `userId` or `sessionId` is omitted,
the provider lazily generates stable IDs for that provider instance:

```ts
const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware(),
  tools: honcho.tools(),
  maxSteps: 3,
  prompt: "What should I focus on today?",
});
```

You can still set explicit provider defaults for deterministic IDs:

```ts
const honcho = createHoncho({
  defaultUserId: "user",
  defaultAssistantId: "assistant",
  defaultSessionId: "session",
});
```

Resolution behavior:
- `assistantId` defaults to `"assistant"`
- missing `userId` lazily generates a provider-scoped user ID
- missing `sessionId` lazily generates a provider-scoped session ID

Override per call when needed, or disable session behavior with `sessionId: null`.

## Quick Start

```ts
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createHoncho } from "@honcho-ai/ai-sdk";

const honcho = createHoncho();

const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware(),
  prompt: "What should I focus on today?",
});
```

This injects Honcho context using lazily generated peer/session IDs.
For deterministic identity/threading, pass explicit IDs or provider defaults.

## Add Persistence

Set `sessionId` when you want explicit thread boundaries.
Session mode is active by default (auto-generated when omitted), and can be
disabled per call with `sessionId: null`:

```ts
const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({
    userId: "user-123",
    sessionId: "chat-456",
  }),
  prompt: "What should I focus on today?",
});
```

With session mode active:
- output is always persisted as `assistantId` (default: `"assistant"`)
- input is persisted when `persistInput` is `true` (default)

## Add Tools

```ts
const { text } = await generateText({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({
    userId: "user-123",
    sessionId: "chat-456",
  }),
  tools: honcho.tools({
    userId: "user-123",
    sessionId: "chat-456",
  }),
  maxSteps: 3,
  prompt: "What should I focus on today?",
});
```

Available tools:
- `honcho_chat` (dialectic reasoning)
- `honcho_context`
- `honcho_search`
- `honcho_search_conclusions`
- `honcho_get_representation`
- `honcho_save_conclusion`

## Messages Array Usage

If you already pass a `messages` array to `generateText`, disable Honcho history injection to avoid duplication:

```ts
await generateText({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({
    userId: "user-123",
    sessionId: "chat-456",
    injectHistory: false,
  }),
  messages: conversationHistory,
});
```

## Multi-Peer

Choose which AI peer is generating with `assistantId`:

```ts
await generateText({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({
    assistantId: "agent-coordinator",
    userId: "alice",
    sessionId: "group-123",
  }),
  prompt: "Coordinate next steps for Alice.",
});
```

```ts
await generateText({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({
    assistantId: "agent-specialist",
    userId: "bob",
    sessionId: "group-123",
  }),
  prompt: "Respond as specialist for Bob.",
});
```

## Manual Input Persistence

When your app persists user input itself, set `persistInput: false`:

```ts
await honcho.send({
  userId: "alice",
  sessionId: "group-123",
  content: "Can you help me plan this sprint?",
});

await generateText({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({
    assistantId: "coordinator",
    userId: "alice",
    sessionId: "group-123",
    persistInput: false,
  }),
  prompt: "Can you help me plan this sprint?",
});
```

## Direct SDK Access

For advanced use cases, use the underlying `@honcho-ai/sdk` client:

```ts
const session = await honcho.client.session("chat-456");
const context = await session.context({
  peerPerspective: "assistant",
  peerTarget: "user-123",
  summary: true,
});

const openAIMessages = context.toOpenAI("assistant");
const anthropicMessages = context.toAnthropic("assistant");
```

## Experimental Modules

These are still exposed as separate modules:
- `@honcho-ai/ai-sdk/openai`
- `@honcho-ai/ai-sdk/identity`

## Development

```bash
npm run typecheck
npm run build
```

## License

Apache-2.0
