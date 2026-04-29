# @honcho-ai/ai-sdk

Memory middleware and tools for the [Vercel AI SDK](https://sdk.vercel.ai), powered by [Honcho](https://honcho.dev).

> **Memory that thinks about your users, not memory that retrieves what they said.**

Honcho models the user behind the conversation — preferences, patterns, what they've told you over time — and injects that model into your prompts. That's different from a vector DB, which retrieves passages your user has seen. If you've reached for "memory" and ended up with semantic search that returned the wrong thing, you wanted reasoning, not retrieval.

This package wires Honcho into Vercel AI SDK apps via a single middleware: wrap your model once with `wrapLanguageModel({ model, middleware: honcho.middleware({...}) })`, and every `generateText` / `streamText` call accumulates memory automatically. For Honcho concepts beyond the SDK (peers, sessions, observation modes, dialectic chat), see [docs.honcho.dev](https://docs.honcho.dev).

> Previously published as `@honcho/ai-sdk`. The new package has a flat config API (`honcho.middleware({ userId, sessionId })`) instead of the old session-handle chain. Uninstall `@honcho/ai-sdk` and install `@honcho-ai/ai-sdk`.

## Use the integration skill (Claude Code)

Integrating into an existing Vercel AI SDK app? This package ships an Anthropic Skill that walks the agent through the integration. After `npm install @honcho-ai/ai-sdk`:

```bash
mkdir -p ~/.claude/skills/honcho-vercel-ai-sdk
ln -sf "$(pwd)/node_modules/@honcho-ai/ai-sdk/skills/honcho-vercel-ai-sdk/SKILL.md" \
       ~/.claude/skills/honcho-vercel-ai-sdk/SKILL.md
```

If you cloned this repo for source review or examples, point the symlink at the cloned source instead:

```bash
ln -sf "$(pwd)/skills/honcho-vercel-ai-sdk/SKILL.md" \
       ~/.claude/skills/honcho-vercel-ai-sdk/SKILL.md
```

Restart your Claude Code session, then invoke `/honcho-vercel-ai-sdk`. The skill recognizes your `generateText` / `streamText` call sites, identifies your auth and session ID source, and applies the integration in place.

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

If `userId` or `sessionId` is omitted, the provider lazily generates IDs for that
provider instance.

This is convenient for local scripts, demos, and single-user flows. For server apps
or any setup where one provider instance may handle many users or conversations,
pass `userId` and `sessionId` explicitly per request so memory does not bleed across
requests.

You can also set explicit provider defaults for deterministic IDs:

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
import { generateText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { createHoncho } from "@honcho-ai/ai-sdk";

const honcho = createHoncho({
  defaultAssistantId: "assistant",
});

const model = wrapLanguageModel({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({
    userId: request.user.id,
    sessionId: request.chatId,
  }),
});

const { text } = await generateText({
  model,
  prompt: "What should I focus on today?",
});
```

This is the recommended pattern for apps: keep the assistant identity stable, and
pass `userId` plus `sessionId` from request context.

### Local Scripts / Single-User Zero-Config

```ts
const honcho = createHoncho();

const model = wrapLanguageModel({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware(),
});

const { text } = await generateText({
  model,
  tools: honcho.tools(),
  maxSteps: 3,
  prompt: "What should I focus on today?",
});
```

This uses generated IDs scoped to that provider instance. It is fine for local
experiments and single-user flows, but not the safest default for multi-user server
traffic.

## Add Persistence

Set `sessionId` when you want explicit thread boundaries.
Session mode is active by default (auto-generated when omitted), and can be
disabled per call with `sessionId: null`:

```ts
const { text } = await generateText({
  model: wrapLanguageModel({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({
      userId: "user-123",
      sessionId: "chat-456",
    }),
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
  model: wrapLanguageModel({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({
      userId: "user-123",
      sessionId: "chat-456",
    }),
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
  model: wrapLanguageModel({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({
      userId: "user-123",
      sessionId: "chat-456",
      injectHistory: false,
    }),
  }),
  messages: conversationHistory,
});
```

## Multi-Peer

Choose which AI peer is generating with `assistantId`:

```ts
await generateText({
  model: wrapLanguageModel({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({
      assistantId: "agent-coordinator",
      userId: "alice",
      sessionId: "group-123",
    }),
  }),
  prompt: "Coordinate next steps for Alice.",
});
```

```ts
await generateText({
  model: wrapLanguageModel({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({
      assistantId: "agent-specialist",
      userId: "bob",
      sessionId: "group-123",
    }),
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
  model: wrapLanguageModel({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({
      assistantId: "coordinator",
      userId: "alice",
      sessionId: "group-123",
      persistInput: false,
    }),
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
