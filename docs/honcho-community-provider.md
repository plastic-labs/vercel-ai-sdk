# Honcho

`@honcho/ai-sdk` wraps any AI SDK model with persistent, reasoning-backed user memory. [Honcho](https://honcho.dev) is not a conversation log -- it derives conclusions about users, builds evolving representations over time, and can answer natural language questions about users from their full interaction history.

The integration is middleware and tools that compose with whatever provider you're already using. Your model stays yours -- Anthropic, OpenAI, Google, anything with an AI SDK provider. Honcho injects relevant context into the system prompt before generation and persists messages after. The model also gets six tools it can call mid-conversation to query or update what it understands about the user.

> **Note:** Honcho is not a model provider -- it's middleware. It augments any AI SDK model with persistent memory without replacing your provider. Use it alongside `@ai-sdk/anthropic`, `@ai-sdk/openai`, or any other provider.

## Setup

```bash
bun add @honcho/ai-sdk
```

### API Key

Get your API key and workspace ID from [honcho.dev](https://honcho.dev) and set them as environment variables:

```bash
export HONCHO_API_KEY=your-api-key
export HONCHO_WORKSPACE_ID=your-workspace-id
```

## Provider Instance

Create a Honcho provider instance with `createHoncho`:

```typescript
import { createHoncho } from '@honcho/ai-sdk';

const honcho = createHoncho({
  workspaceId: process.env.HONCHO_WORKSPACE_ID!,
  // apiKey defaults to process.env.HONCHO_API_KEY
});
```

## Sessions

A session handle represents a conversation thread between a user and an assistant. It manages dual-peer identity -- Honcho tracks who said what, and builds a model of the user from the assistant's perspective.

```typescript
const session = honcho.session('session-123', {
  user: 'user-abc',
  assistant: 'assistant-xyz',
});
```

Session handles are synchronous and lightweight. No API calls are made until you use the session's middleware or tools, which lazily initialize backend resources via `ensure()`.

### Peers

Honcho's core primitive is the **peer** -- any entity that persists and changes over time. In a typical setup:

- The **user peer** has `observe_me: true` -- its messages are observed and reasoned about
- The **assistant peer** has `observe_others: true` -- it builds understanding of the user

This dual-peer model means Honcho automatically builds a representation of the user from the assistant's perspective, including derived conclusions, behavioral patterns, and biographical facts.

## Middleware

The session provides middleware compatible with `wrapLanguageModel`. It handles two things automatically:

1. **Before generation** -- fetches context from Honcho (user representation, peer card, session summary, recent messages) and injects it into the system prompt
2. **After generation** -- persists user and assistant messages back to Honcho with correct peer attribution

```typescript
import { wrapLanguageModel, generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const model = wrapLanguageModel({
  model: anthropic('claude-sonnet-4-20250514'),
  middleware: session.middleware(),
});
```

The middleware conforms to `LanguageModelV3Middleware` with `specificationVersion: 'v3'`.

## Tools

Honcho exposes six tools that the model can invoke during generation to query and update what it knows about the user:

| Tool | Description |
|---|---|
| `honcho_chat` | Dialectic reasoning. Ask natural language questions about the user and get synthesized answers derived from their full interaction history. |
| `honcho_context` | Retrieve recent session context (representation, card, summary, and recent messages) from the assistant's perspective of the user. |
| `honcho_search` | Semantic search across stored conversation messages. |
| `honcho_search_conclusions` | Query derived conclusions: personality traits, preferences, behavioral patterns, biographical facts. |
| `honcho_get_representation` | Get a comprehensive synthesized profile of the user. |
| `honcho_save_conclusion` | Persist an observation or conclusion about the user for future sessions. |

```typescript
const result = await generateText({
  model,
  tools: session.tools(),
  prompt: 'What patterns have you noticed about me?',
});
```

Tools are pre-bound to the session's peers, so the model doesn't need to specify peer IDs.

## Examples

### `generateText`

A complete example with memory-augmented generation:

```typescript
import { createHoncho } from '@honcho/ai-sdk';
import { wrapLanguageModel, generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const honcho = createHoncho({
  workspaceId: process.env.HONCHO_WORKSPACE_ID!,
});

const session = honcho.session('session-123', {
  user: 'user-abc',
  assistant: 'assistant-xyz',
});

const model = wrapLanguageModel({
  model: anthropic('claude-sonnet-4-20250514'),
  middleware: session.middleware(),
});

const { text } = await generateText({
  model,
  tools: session.tools(),
  prompt: 'Based on our conversations, what do I care about most?',
});
```

On the first turn, Honcho returns empty context. On subsequent turns, the model receives the user's representation, derived conclusions, and recent message history -- automatically, with no additional code.

### `streamText`

```typescript
import { createHoncho } from '@honcho/ai-sdk';
import { wrapLanguageModel, streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

const honcho = createHoncho({
  workspaceId: process.env.HONCHO_WORKSPACE_ID!,
});

const session = honcho.session('session-456', {
  user: 'user-abc',
  assistant: 'assistant-xyz',
});

const model = wrapLanguageModel({
  model: openai('gpt-4o'),
  middleware: session.middleware(),
});

const result = streamText({
  model,
  tools: session.tools(),
  prompt: 'What should we work on next?',
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

Messages are persisted after the stream completes. The middleware returns the persistence promise from `flush()`, so the stream stays open until Honcho confirms the write.

### Next.js Route Handler

```typescript
import { createHoncho } from '@honcho/ai-sdk';
import { wrapLanguageModel, streamText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const honcho = createHoncho({
  workspaceId: process.env.HONCHO_WORKSPACE_ID!,
});

export async function POST(req: Request) {
  const { messages, sessionId, userId } = await req.json();

  const session = honcho.session(sessionId, {
    user: userId,
    assistant: 'my-app',
  });

  const model = wrapLanguageModel({
    model: anthropic('claude-sonnet-4-20250514'),
    middleware: session.middleware(),
  });

  const result = streamText({
    model,
    tools: session.tools(),
    messages,
  });

  return result.toDataStreamResponse();
}
```

## How It Works

Each turn follows this lifecycle:

1. **`transformParams`** -- Middleware calls Honcho's session context API using the assistant's perspective on the user (`peer_perspective = assistant`, `peer_target = user`). Honcho returns the user's representation, peer card, session summary, and recent messages. These are formatted as XML sections and injected into the system prompt.

2. **Generation** -- The model generates with full context. If tools are available, it can invoke `honcho_chat` to ask reasoning questions about the user, `honcho_context` to fetch recent session context on demand, `honcho_search` to find specific past conversations, or `honcho_save_conclusion` to persist an important observation.

3. **`flush` / `wrapGenerate`** -- After generation completes, middleware extracts the user's message and the assistant's response, then persists both to Honcho with correct peer attribution. Tool continuation steps (multi-step tool use) skip re-persisting the user message.

4. **Between sessions** -- Honcho's reasoning engine processes stored messages asynchronously, deriving conclusions, updating the user's representation, and consolidating memory. The next session starts with richer context.

## Configuration

### Session Options

```typescript
const session = honcho.session('session-123', {
  user: 'user-abc',
  assistant: 'assistant-xyz',
}, {
  context: {
    tokens: 4096,          // Max tokens for context injection
    includeSummary: true,  // Include session summary
    format: customFormatter, // Custom context formatter
  },
  persistence: {
    enabled: true,         // Enable message persistence
    onError: (err) => {    // Error handler
      console.error('[honcho]', err);
    },
  },
});
```

### Provider Options

```typescript
const honcho = createHoncho({
  workspaceId: 'ws-123',
  apiKey: 'hk_...',           // Defaults to HONCHO_API_KEY env var
  environment: 'production',   // 'production' | 'local'
  baseURL: 'https://...',     // Custom API endpoint
});
```

## Additional Modules

| Module | Import | Description |
|---|---|---|
| Multi-Agent | `@honcho/ai-sdk/multi-agent` | Peer-to-peer observation between multiple agents |
| Dreaming | `@honcho/ai-sdk/dreaming` | Autonomous memory consolidation and self-reflection |
| Identity | `@honcho/ai-sdk/identity` | Live identity documents backed by Honcho peer cards |
| OpenAI | `@honcho/ai-sdk/openai` | Direct OpenAI SDK integration (without AI SDK) |

> **Note:** `multi-agent`, `dreaming`, and `identity` are frontier modules. They are production-usable, but APIs may evolve as patterns harden.

### Multi-Agent (`@honcho/ai-sdk/multi-agent`)

Use this when multiple assistants should form memory about each other (not just the user).

```typescript
import { createMultiAgentSession, multiAgentMiddleware } from '@honcho/ai-sdk/multi-agent';
import { wrapLanguageModel, generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const group = await createMultiAgentSession({
  provider: { workspaceId: process.env.HONCHO_WORKSPACE_ID! },
  sessionId: 'group-chat-1',
  peers: [
    { peerId: 'user-abc', observeMe: true, observeOthers: false },
    { peerId: 'planner-agent', observeMe: false, observeOthers: true },
    { peerId: 'critic-agent', observeMe: false, observeOthers: true },
  ],
});

const plannerModel = wrapLanguageModel({
  model: anthropic('claude-sonnet-4-6'),
  middleware: multiAgentMiddleware(group, 'planner-agent'),
});

const { text } = await generateText({
  model: plannerModel,
  prompt: 'Given what you know about the user, propose a plan.',
});
```

Useful APIs:

- `group.getPeerPerspective(observerPeerId, targetPeerId)` -- one agent's view of another
- `group.askAboutPeer(observerPeerId, targetPeerId, query)` -- dialectic query from one agent about another
- `group.scheduleDream(observerPeerId, observedPeerId)` -- trigger consolidation for a relationship

### Dreaming (`@honcho/ai-sdk/dreaming`)

Use this to run explicit consolidation/reflection cycles outside user turns (cron jobs, background workers, end-of-session hooks).

```typescript
import { createDreamingAgent } from '@honcho/ai-sdk/dreaming';

const dreamer = await createDreamingAgent({
  provider: { workspaceId: process.env.HONCHO_WORKSPACE_ID! },
  observerPeerId: 'assistant-xyz',
  observedPeerId: 'user-abc',
  sessionId: 'session-123',
});

const insights = await dreamer.fullCycle({
  pollIntervalMs: 3000,
  timeoutMs: 120000,
});
```

Useful APIs:

- `dreamer.dream()` -- schedule a dream
- `dreamer.waitForCompletion()` -- wait until queue work completes
- `dreamer.reflect()` / `dreamer.fullCycle()` -- synthesize post-consolidation insights

### Identity (`@honcho/ai-sdk/identity`)

Use identity cards when you want a structured, editable memory document (append/replace/diff/search) on top of Honcho's peer card.

```typescript
import {
  createPeerIdentity,
  createMultiPerspectiveIdentity,
  compareIdentityPerspectives,
} from '@honcho/ai-sdk/identity';

const identity = await createPeerIdentity({
  provider: { workspaceId: process.env.HONCHO_WORKSPACE_ID! },
  peerId: 'assistant-xyz',
  targetPeerId: 'user-abc',
});

await identity.merge(['Prefers short responses', 'Works in finance']);
const snapshot = await identity.snapshot();

const perspectives = await createMultiPerspectiveIdentity({
  provider: { workspaceId: process.env.HONCHO_WORKSPACE_ID! },
  observerPeerIds: ['assistant-xyz', 'planner-agent', 'critic-agent'],
  targetPeerId: 'user-abc',
});

const compared = await compareIdentityPerspectives(perspectives);
```

Useful APIs:

- `identity.merge(entries)` -- add deduplicated facts
- `identity.diff(snapshot)` -- track memory changes over time
- `compareIdentityPerspectives(...)` -- consensus vs unique beliefs per observer

### OpenAI (`@honcho/ai-sdk/openai`)

Use this when you're integrating with the OpenAI SDK directly (without AI SDK tool wrappers).

```typescript
import OpenAI from 'openai';
import { createHoncho } from '@honcho/ai-sdk';
import { honchoOpenAITools } from '@honcho/ai-sdk/openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const honcho = createHoncho({
  workspaceId: process.env.HONCHO_WORKSPACE_ID!,
});

const honchoTools = honchoOpenAITools({
  client: honcho.client,
  workspaceId: process.env.HONCHO_WORKSPACE_ID!,
  defaultPeerId: 'user-abc',
  defaultObserverPeerId: 'assistant-xyz',
  defaultSessionId: 'session-123',
});
```

Pass `honchoTools.definitions` to OpenAI tool calling, then execute each call with `honchoTools.execute(name, args)`.

## Resources

- [Honcho Documentation](https://docs.honcho.dev)
- [GitHub Repository](https://github.com/plastic-labs/vercel-ai-sdk-package)
- [Honcho Platform](https://honcho.dev)
- [Plastic Labs](https://plasticlabs.ai)
