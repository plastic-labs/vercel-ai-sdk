---
name: honcho-vercel-ai-sdk
description: Integrate Honcho memory into a Vercel AI SDK app, or debug a broken Honcho + Vercel AI SDK setup. Use when a developer has an existing Vercel AI SDK app (Next.js / Express / Hono / similar) and wants AI memory that thinks about users, not memory that retrieves what they said. Edit-driven — the skill reads the codebase, identifies where Honcho fits, and applies the integration to those specific call sites.
allowed-tools: Read, Glob, Grep, Bash(npm:*), Bash(node:*), Bash(bun:*), Edit, Write, AskUserQuestion
user-invocable: true
---

# Add Honcho memory to a Vercel AI SDK app

> **Memory that thinks about your users, not memory that retrieves what they said.**

- Follow each phase in order. Do not skip preflight.
- This skill is edit-driven — it reads the dev's codebase, identifies fit, and edits in place. Confirm before each file write.
- If any phase fails, stop and surface the failure — do not route around it.

## When to use / can be skipped

Use when: adding Honcho memory to an existing Vercel AI SDK app, or diagnosing a broken Honcho + Vercel AI SDK integration.

Skip when: you don't have an existing `generateText` / `streamText` / `generateObject` call site yet — start with the package's [README Quick Start](../../README.md) first, then come back. Or you want a vector-DB / RAG retrieval layer — Honcho is reasoning + peer modeling, not retrieval; this skill won't help.

For **Honcho fundamentals** (peers, sessions, observation modes, base install), see the `honcho-integration` skill or [docs.honcho.dev](https://docs.honcho.dev). This skill is Vercel-AI-SDK-specific.

## Skill discoverability (read this before invoking)

This skill ships with `@honcho-ai/ai-sdk`. Claude Code does not auto-discover it. To invoke as `/honcho-vercel-ai-sdk` in a new session, symlink it into your project's or user's `.claude/skills/` directory, then restart the Claude Code session:

```bash
# Path A — cloned the source repo (for demo, examples, or source review)
mkdir -p ~/.claude/skills/honcho-vercel-ai-sdk
ln -sf <path-to-cloned-repo>/skills/honcho-vercel-ai-sdk/SKILL.md \
       ~/.claude/skills/honcho-vercel-ai-sdk/SKILL.md

# Path B — npm-installed only
mkdir -p ~/.claude/skills/honcho-vercel-ai-sdk
ln -sf node_modules/@honcho-ai/ai-sdk/skills/honcho-vercel-ai-sdk/SKILL.md \
       ~/.claude/skills/honcho-vercel-ai-sdk/SKILL.md
```

Restart the Claude Code session after symlinking. Or read this file directly and execute each phase as a checklist.

## Phase 0 — Preflight

Run these checks before routing:

```bash
node --version                                        # require >= 18
[[ -f package.json ]] || { echo "no package.json"; exit 1; }
grep -q '"ai"' package.json || \
  echo "warning: 'ai' (Vercel AI SDK) not in package.json — confirm with the user"
grep -q '"@honcho-ai/ai-sdk"' package.json && \
  node -e "console.log(require('./node_modules/@honcho-ai/ai-sdk/package.json').version)" || \
  echo "@honcho-ai/ai-sdk not installed yet"
```

### Gate: version check (if `@honcho-ai/ai-sdk` already installed)

The post-V3 surface uses `honcho.middleware({ userId, sessionId, assistantId })` passed as the `middleware:` option to `generateText` / `streamText`. Pre-V3 versions used a session-handle chain (`honcho.session(...).middleware()`). If the installed version is pre-V3, instruct the dev to upgrade before continuing — middleware shape doesn't apply to pre-V3 installs.

```bash
node -e '
  const v = require("./node_modules/@honcho-ai/ai-sdk/package.json").version;
  const [maj] = v.split(".").map(Number);
  if (maj < 1) { console.error(`pre-V3 (${v}) — upgrade to >=1.0.0`); process.exit(1); }
'
```

### Gate: route INTEGRATE / DEBUG / SCAFFOLD

Use **AskUserQuestion**:

- **INTEGRATE** — "I have a Vercel AI SDK app already, add Honcho memory to it." → INTEGRATE path (Phases 1–3, then Phase N).
- **DEBUG** — "My Honcho + Vercel AI SDK setup is broken; help me triage." → DEBUG path (Phases 1–3, then Phase N).
- **SCAFFOLD** — "Start a new app pre-wired with Honcho." → exit with the message below.

> SCAFFOLD path is not yet supported (v2 scope). To start a new app pre-wired with Honcho, follow the [README Quick Start](../../README.md), then invoke this skill (INTEGRATE path) once you have a `generateText` / `streamText` call site.

---

## INTEGRATE path

The skill reads the codebase, identifies where Honcho fits, and applies the integration to those specific call sites. Minimal interrogation; light "ask before file write" gates.

### Phase 1 — Recognize the codebase

Find every Vercel AI SDK call site, the auth pattern, and the session ID source.

```bash
# Call sites
grep -rn "generateText\|streamText\|generateObject" --include='*.ts' --include='*.tsx' --include='*.js' .

# Auth pattern (best-effort)
grep -rn "next-auth\|getServerSession\|@auth/\|lucia\|iron-session\|jose\|jsonwebtoken" \
     --include='*.ts' --include='*.tsx' .

# Session/conversation ID source
grep -rn "sessionId\|chatId\|conversationId\|threadId" --include='*.ts' --include='*.tsx' . | head -20
```

#### Gate: zero call sites found

If no `generateText` / `streamText` / `generateObject` matches: stop with the message below. The skill does not scaffold a model call from scratch.

> No model call sites detected. The skill expects an existing Vercel AI SDK app. Make at least one call (see [README Quick Start](../../README.md)), then re-invoke.

#### Gate: unrecognized auth pattern

If the auth grep returns nothing recognized, ask the dev directly. Don't guess.

Use **AskUserQuestion**: "Where does the user / session ID come from in your app? Give a path and example shape (e.g. `app/api/chat/route.ts:14, request.user.id from JWT cookie`)."

#### Gate: multiple disjoint call sites

If grep finds calls in 3+ different files (e.g. `/api/chat`, `/api/agent`, `/api/draft`), use **AskUserQuestion** to scope which to integrate first. Wire one route end-to-end before fanning out — the others should follow the same shape once the first works.

### Phase 2 — Wire the middleware

The integration is two edits per route:

1. Create a Honcho provider (one-time, module-scoped).
2. Wrap the model with `wrapLanguageModel({ model, middleware: honcho.middleware({...}) })` and pass the wrapped model to `generateText` / `streamText`.

#### 2.1 Create the provider

Add at the top of the route file (or a shared `lib/honcho.ts` if you have multiple routes):

```ts
import { createHoncho } from "@honcho-ai/ai-sdk";

export const honcho = createHoncho({
  defaultAssistantId: "assistant",  // stable assistant identity
});
```

`createHoncho()` reads `HONCHO_API_KEY` and `HONCHO_WORKSPACE_ID` from env. Confirm both are set in `.env` / deployment config before continuing — a missing key surfaces as a 401 on the first model call, not at provider construction.

```bash
grep -E '^(HONCHO_API_KEY|HONCHO_WORKSPACE_ID)=' .env 2>/dev/null
```

Gate edit on confirmation: "I'll add `import { createHoncho } from \"@honcho-ai/ai-sdk\"` and a module-scoped provider to `<file>:<line>`. OK?"

#### 2.2 Wrap the model with Honcho middleware

```ts
import { generateText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";

const model = wrapLanguageModel({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({
    userId: request.user.id,            // from your auth context
    sessionId: request.chatId,          // stable per conversation
  }),
});

const { text } = await generateText({
  model,
  prompt,
});
```

`wrapLanguageModel` is the Vercel AI SDK v6 API for applying middleware. `honcho.middleware({...})` returns a `LanguageModelV3Middleware`, which `wrapLanguageModel` consumes.

For `streamText`, the shape is identical — wrap the model, pass it in:

```ts
const model = wrapLanguageModel({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({ userId, sessionId }),
});

const result = await streamText({ model, prompt });
```

If the route uses `messages` instead of a single `prompt`, only the call shape changes — the model wrapping stays the same:

```ts
const result = await streamText({
  model,
  messages,                             // CoreMessage[] — array, not string
});
```

### Phase 3 — Configure peers and sessions

Honcho's data model has three primitives — peers (entities the AI tracks), sessions (conversation boundaries), and observation modes (which peer's messages get observed).

#### 3.1 Peer model decision

Use **AskUserQuestion**:

- **Per-user peer** (recommended for multi-user apps) — `userId: request.user.id` per request. One peer per real user; memory does not bleed across users.
- **Per-instance peer** (single-user / local script) — `createHoncho()` without `userId` lazily generates a provider-scoped user ID. Fine for local experiments. The provider warns once on first use.

#### 3.2 Session boundary decision

Use **AskUserQuestion**:

- **Per-conversation session** (recommended) — `sessionId: request.chatId` per request, stable for the lifetime of one chat thread. New thread = new session.
- **No session** — `sessionId: null` disables session mode. Use only if you want raw memory ops without conversation grouping.

Stable session IDs are load-bearing. If `sessionId` changes between requests in the same conversation, Honcho treats them as separate threads and the model loses context — common cause of "the AI forgot what we just talked about."

#### 3.3 Assistant identity

`defaultAssistantId: "assistant"` is the recommended default. Override only if you have multiple distinct AI personas in one app (and want each to maintain its own memory). The default value `"assistant"` is also Honcho's expected value for single-persona apps.

---

## DEBUG path

A broken Honcho + Vercel AI SDK setup. Triage by symptom.

### Phase 1 — Collect symptoms

Ask the dev:

1. What error or unexpected behavior? (Quote the error message verbatim if possible.)
2. What's the `generateText` / `streamText` call shape? (`prompt` vs `messages`?)
3. Versions: `node -e "console.log(require('./node_modules/@honcho-ai/ai-sdk/package.json').version)"` and `node -e "console.log(require('./node_modules/ai/package.json').version)"`
4. Is `HONCHO_API_KEY` set? (Don't print the key — just confirm presence.)

```bash
[[ -n "$HONCHO_API_KEY" ]] && echo "key set" || echo "key MISSING"
```

### Phase 2 — Triage

Match symptoms to causes. The first column is what the dev sees; the third column is the fix.

| Symptom | Cause | Fix |
|---|---|---|
| Model output is normal but no memory accumulates across calls | Model not wrapped — `wrapLanguageModel` is missing, so middleware never fires | Wrap the model: `const model = wrapLanguageModel({ model: openai(...), middleware: honcho.middleware({ userId, sessionId }) })`, then pass `model` to `generateText` |
| Code uses `middleware: honcho.middleware({...})` directly on `generateText` | This pattern is in older docs but isn't a typechecking option in `ai@^6` — `middleware` is only valid via `wrapLanguageModel` | Switch to `wrapLanguageModel({ model, middleware })` and pass the wrapped `model` to `generateText`. See Phase 2.2 above |
| TypeScript error: `Argument of type 'string' is not assignable to parameter of type 'CoreMessage[]'` | `prompt` and `messages` confused — middleware fires on either, but the call shape must be one or the other | Pick `prompt: string` OR `messages: CoreMessage[]`. Don't pass both. |
| AI's responses leak into "what the user said" memory | `observe_me=True` on the AI peer (default for human peers, wrong for AI) | Set `observe_me=False` on the assistant peer. See [docs.honcho.dev](https://docs.honcho.dev) observation modes |
| AI forgets the conversation between requests in the same chat | `sessionId` not stable across requests — generated fresh each time | Pass a stable per-conversation ID (e.g. `request.chatId`) as `sessionId`. Or omit it and let the provider auto-generate a single ID for the whole instance (single-user only) |
| 401 on first model call | `HONCHO_API_KEY` not in env, or wrong workspace | Confirm `HONCHO_API_KEY` and `HONCHO_WORKSPACE_ID` in `.env` and the deployment config. Check honcho.dev dashboard for the key |
| `Cannot find module '@honcho-ai/sdk'` | Peer dep missing — `@honcho-ai/ai-sdk` requires `@honcho-ai/sdk` to resolve at runtime | `npm install @honcho-ai/sdk` (or `bun add @honcho-ai/sdk`) |

### Phase 3 — Apply fix

Apply the matched fix from Phase 2. Re-run the failing call. Then run **Phase N — Verification** to confirm.

### Phase 4 — Escalation (if Phase 2 didn't match)

If none of the rows above match, capture the diagnostic info from Phase 1 and open an issue at [github.com/plastic-labs/vercel-ai-sdk-package/issues](https://github.com/plastic-labs/vercel-ai-sdk-package/issues). Include the error verbatim, the call shape, and both versions. Don't guess past this point — the package's maintainers are faster at unfamiliar failure modes.

---

## Phase N — Verification

Both INTEGRATE and DEBUG converge here. Three checks; the third is gated on env.

### N.1 Re-read edited files

Read every file the skill edited and confirm:

- `import { createHoncho } from "@honcho-ai/ai-sdk"` is present
- The provider is constructed at module scope, not inside the request handler (constructing per-request loses the provider's ID-cache and re-warns on every call)
- `wrapLanguageModel({ model, middleware: honcho.middleware({...}) })` is applied to every model that gets passed to `generateText` / `streamText`
- `userId` and `sessionId` are sourced from the request context (not hardcoded), unless this is a local single-user script

### N.2 Type-check passes

Detect the project's typecheck script and run it; fall back to `tsc --noEmit`.

```bash
if grep -q '"typecheck"' package.json; then
  npm run typecheck
elif command -v bun >/dev/null 2>&1; then
  bun run tsc --noEmit
else
  npx tsc --noEmit
fi
```

If typecheck fails on lines the skill edited, fix and re-run before declaring done. If it fails on pre-existing code unrelated to the integration, surface as a finding but don't fix (out of scope).

### N.3 Runtime smoke test (optional — gated on `HONCHO_API_KEY`)

```bash
[[ -n "$HONCHO_API_KEY" ]] || { echo "skip — no HONCHO_API_KEY"; exit 0; }
```

If the env var is set, fire one real call against the wrapped model and assert middleware fired + Honcho returned context. The package ships a script for this:

```bash
node node_modules/@honcho-ai/ai-sdk/scripts/verify-integration.js \
  || bun run node_modules/@honcho-ai/ai-sdk/scripts/verify-integration.ts
```

Or if you cloned the repo:

```bash
bun run scripts/verify-integration.ts
```

Success looks like: a 200 response from the model + a non-empty conversation echoed back from Honcho. Failure surfaces as either a 4xx (env / config) or a stack trace (genuine bug).

---

## Concept Mapping

| Vercel AI SDK | Honcho | Notes |
|---|---|---|
| `messages: CoreMessage[]` | `peer.add_messages()` (server-side) | Middleware persists each turn automatically. You don't call `add_messages` from app code. |
| `model` (e.g. `openai("gpt-4o-mini")`) | model-agnostic | Honcho is provider-neutral. Wrap any model with `wrapLanguageModel({ model, middleware: honcho.middleware({...}) })`. Outputs flow through Honcho's middleware regardless of provider. |
| `tools` parameter to `generateText` | `honcho.tools()` | Spread `...honcho.tools()` alongside your own tools to give the model direct memory access (search, ask, recall). |
| route-handler `userId` (from auth) | Honcho **peer** | One peer per real user. Stable across sessions. |
| route-handler `sessionId` / `chatId` | Honcho **session** | Conversation boundary. Stable for one thread; new thread = new session. |
| `defaultAssistantId: "assistant"` | Honcho **assistant peer** | Stable AI identity. Default value `"assistant"` is recommended for single-persona apps. |
| (none) | **observation mode** | Whose messages each peer "observes." Human peers default to `observe_me=True`; AI peers should be `observe_me=False`. |

For deeper concepts (workspace, dialectic chat, conclusions), see [docs.honcho.dev](https://docs.honcho.dev) or the `honcho-integration` skill.

## Common Mistakes

| Mistake | Why it's wrong | Fix |
|---|---|---|
| Treating Honcho as a vector DB / RAG layer | Honcho is reasoning + peer modeling. RAG retrieves facts; Honcho models users. They solve different problems. | Read [the framing sentence](#add-honcho-memory-to-a-vercel-ai-sdk-app) and the [Honcho docs](https://docs.honcho.dev). If you want vector retrieval, use a vector DB. |
| Installing `@honcho-ai/ai-sdk` without wrapping the model | The package's import is half the integration. Without `wrapLanguageModel({ model, middleware: honcho.middleware({...}) })`, nothing fires. | Grep for `generateText` / `streamText` and confirm every call uses a wrapped model. |
| Sharing one peer ID across all users in a multi-user app | Memory bleeds across users. The AI starts mixing one user's preferences into another's responses. | Pass `userId` from your auth context per request. |
| Setting `observe_me=True` on the AI peer | The AI's outputs get treated as user signal. The user model becomes a mirror of the AI's own writing. | `observe_me=False` on the assistant peer. |
| Generating a fresh `sessionId` per request | New session every request = no conversation memory. The AI forgets between turns. | Pass a stable per-conversation ID (e.g. `request.chatId`). |
| Constructing the provider inside a route handler | Per-request `createHoncho()` calls lose the in-memory ID cache and re-emit auto-ID warnings on every call. | Construct once at module scope; re-use across requests. |

## Resources

- [Honcho docs](https://docs.honcho.dev) — concepts, dialectic chat, observation modes, workspace model
- `honcho-integration` skill — generic Honcho integration (Python + TS), language-agnostic patterns
- [`@honcho-ai/ai-sdk` README](../../README.md) — base install, environment variables, full API reference
- [Vercel AI SDK docs](https://sdk.vercel.ai) — `generateText` / `streamText` / `generateObject` reference
- [github.com/plastic-labs/vercel-ai-sdk-package](https://github.com/plastic-labs/vercel-ai-sdk-package) — issue tracker, source

## Anti-patterns (things this skill tends to get wrong)

| Anti-pattern | Correction |
|---|---|
| Wrap the model without checking call shape | `prompt: string` and `messages: CoreMessage[]` are mutually exclusive. Confirm one or the other before editing. |
| Hardcode `userId: "test"` for testing purposes | Persists in the actual file. Use the auth context the dev's app already exposes; don't introduce test fixtures into production code. |
| Construct the provider inside the request handler | Provider holds an in-memory ID cache. Module-scope construction is correct; per-request is not. |
| Insert `import { createHoncho } from "@honcho-ai/ai-sdk"` without confirming the package is installed | If the import lands in a file before the package is in `package.json`, the build breaks. Confirm `npm install @honcho-ai/ai-sdk` first. |
| Treat "the call returns text" as success in Phase N | Middleware errors are non-blocking by default — the call returns text whether Honcho fired or not. The verification has to confirm middleware actually ran (logs, dashboard, or smoke script). |
| Skip Phase 0's version check on a pre-existing install | Pre-V3 versions used a session-handle chain. Applying V3 patterns to a pre-V3 install produces a TypeScript error and confused users. |
