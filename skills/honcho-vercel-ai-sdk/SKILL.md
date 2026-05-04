---
name: honcho-vercel-ai-sdk
description: Integrate or debug Honcho memory in a Vercel AI SDK app. Use when wiring generateText / streamText calls or triaging a broken Honcho integration.
allowed-tools: Read, Glob, Grep, Bash(npm:*), Bash(node:*), Bash(bun:*), Edit, Write, AskUserQuestion
user-invocable: true
---

# Add Honcho memory to a Vercel AI SDK app

> **Memory that reasons, not just recalls.**

- Follow each phase in order. Do not skip preflight.
- This skill is edit-driven — it reads the dev's codebase, identifies fit, and edits in place. Confirm before each file write.
- If any phase fails, stop and surface the failure — do not route around it.

## When to use / can be skipped

Use when: adding Honcho memory to an existing Vercel AI SDK app, or diagnosing a broken Honcho + Vercel AI SDK integration.

Skip when: you don't have an existing `generateText` / `streamText` / `generateObject` call site yet — start with the package's [README Quick Start](../../README.md) first, then come back. Or you want a vector-DB / RAG retrieval layer — Honcho is reasoning + peer modeling, not retrieval; this skill won't help.

For **Honcho fundamentals** (peers, sessions, observation modes, base install), see the `honcho-integration` skill or [docs.honcho.dev](https://docs.honcho.dev). This skill is Vercel-AI-SDK-specific.

## Gate policy

3 required AskUserQuestion gates — fire all every run, even in auto mode:

1. Route — INTEGRATE vs DEBUG (Phase 0)
2. App shape — multi-user vs single-user / script (Phase 1)
3. Peer + session confirmation — canonical shape vs customize (Phase 3.1)

Visible code signal is not consent.

## Skill discoverability

See the [package README](../../README.md) for how to load this Skill into your agent (Claude Code, Codex, Cursor, etc.). Or read this file directly and execute each phase as a checklist.

## Phase 0 — Preflight

Run these checks before routing:

```bash
node --version                                        # require >= 18
[[ -f package.json ]] || { echo "no package.json"; exit 1; }
grep -q '"ai"' package.json || \
  echo "warning: 'ai' (Vercel AI SDK) not in package.json — confirm with the user"
grep -q '"@honcho-ai/vercel-ai-sdk"' package.json && \
  node -e "console.log(require('./node_modules/@honcho-ai/vercel-ai-sdk/package.json').version)" || \
  echo "@honcho-ai/vercel-ai-sdk not installed yet"
```

### Gate: route INTEGRATE / DEBUG

Use **AskUserQuestion**:

- **INTEGRATE** — "I have a Vercel AI SDK app already, add Honcho memory to it." → INTEGRATE path (Phases 1–3, then Phase N).
- **DEBUG** — "My Honcho + Vercel AI SDK setup is broken; help me triage." → DEBUG path (Phases 1–3, then Phase N).

If neither fits — e.g., the dev wants to start a brand-new app pre-wired with Honcho — point them at the [README Quick Start](../../README.md) and exit. The skill is edit-driven; it doesn't scaffold.

---

## INTEGRATE path

The skill reads the codebase, identifies where Honcho fits, and applies the integration to those specific call sites. Required gates per [Gate policy](#gate-policy): route, app shape, peer + session confirmation. Apply every run regardless of how unambiguous the codebase looks.

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

#### Gate: app shape (always)

The only thing the agent can't infer from code: is this a **multi-user app** (many humans share one running process, each with their own identity) or a **single-user / script** (one human runs it, no auth layer)?

Most Vercel AI SDK apps are multi-user — assume that default when in doubt. Single-user is rarer: local CLI scripts, personal Discord bots, internal admin jobs.

Use **AskUserQuestion**:

> "Is this app multi-user (real users, each with their own identity) or single-user / script (one human running it, no auth layer)? Most Vercel AI SDK apps are multi-user."

Options:

1. **Multi-user** (recommended default) — many humans share one running process. Wire `userId` from auth (`request.user.id` from next-auth / lucia / JWT). For prototypes without auth yet, `body.userId` works as a stand-in; replace before shipping to production.
2. **Single-user / script** — one human runs this. Omit `userId` from the middleware call; `createHoncho()` auto-generates a stable per-process ID. The provider warns once on first use.

Ask every run. Visible `userId` in the request body doesn't tell the agent which world the app is in — could be real auth, test data in a multi-user app, or leftover scaffolding from a single-user script.

#### Gate: multiple disjoint call sites

If grep finds calls in 3+ different files (e.g. `/api/chat`, `/api/agent`, `/api/draft`), use **AskUserQuestion** to scope which to integrate first. Wire one route end-to-end before fanning out — the others should follow the same shape once the first works.

### Phase 2 — Wire the middleware

The integration is two edits per route:

1. Create a Honcho provider (one-time, module-scoped).
2. Wrap the model with `wrapLanguageModel({ model, middleware: honcho.middleware({...}) })` and pass the wrapped model to `generateText` / `streamText`.

#### 2.1 Create the provider

Add at the top of the route file (or a shared `lib/honcho.ts` if you have multiple routes):

```ts
import { createHoncho } from "@honcho-ai/vercel-ai-sdk";

export const honcho = createHoncho({
  defaultAssistantId: "assistant",  // stable assistant identity
});
```

`createHoncho()` reads `HONCHO_API_KEY` and `HONCHO_WORKSPACE_ID` from env. Confirm both are set in `.env` / deployment config before continuing — a missing key surfaces as a 401 on the first model call, not at provider construction.

```bash
grep -E '^(HONCHO_API_KEY|HONCHO_WORKSPACE_ID)=' .env 2>/dev/null
```

Gate edit on confirmation: "I'll add `import { createHoncho } from \"@honcho-ai/vercel-ai-sdk\"` and a module-scoped provider to `<file>:<line>`. OK?"

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

### Phase 3 — Confirm peer + session model

Honcho's data model has three primitives — peers (entities the AI tracks), sessions (conversation boundaries), and observation modes (which peer's messages get observed). For ~95% of Vercel AI SDK apps, the canonical shape is **per-user peer + per-conversation session** with `defaultAssistantId: "assistant"`. Phase 3 confirms that default rather than re-asking the design space; expand only if the dev wants to override.

#### 3.1 Summary confirmation

**Required gate, every run.** Single binary: accept the canonical shape or customize.

Use **AskUserQuestion** with this shape:

> "Wiring with **per-user peer** (one Honcho peer per real user, keyed by `userId`) + **per-conversation session** (one session per chat thread, keyed by `chatId`) + `defaultAssistantId: \"assistant\"`. This is the canonical shape for multi-user chat apps. Confirm or customize?"

Options:

1. **Confirm** — apply the canonical shape. Skip 3.2.
2. **Customize** — open the design space (3.2 below).

If the dev confirms, proceed to Phase N. If they customize, surface the two questions in 3.2.

#### 3.2 Customize (only when 3.1 → "Customize")

Two follow-up AskUserQuestions, in order:

**Peer model:**
- **Per-user peer** (recommended for multi-user apps) — `userId: request.user.id` per request. One peer per real user; memory does not bleed across users.
- **Per-instance peer** (single-user / local script) — `createHoncho()` without `userId` lazily generates a provider-scoped user ID. The provider warns once on first use.

**Session boundary:**
- **Per-conversation session** (recommended) — `sessionId: request.chatId` per request, stable for the lifetime of one chat thread. New thread = new session.
- **No session** — `sessionId: null` disables session mode. Use only if you want raw memory ops without conversation grouping.

Stable session IDs are load-bearing. If `sessionId` changes between requests in the same conversation, Honcho treats them as separate threads and the model loses context — common cause of "the AI forgot what we just talked about."

#### 3.3 Assistant identity

`defaultAssistantId: "assistant"` is the recommended default. Override only if you have multiple distinct AI personas in one app (and want each to maintain its own memory). Surface as part of the summary in 3.1; don't gate separately.

---

## DEBUG path

A broken Honcho + Vercel AI SDK setup. Triage by symptom.

### Phase 1 — Collect symptoms

Ask the dev:

1. What error or unexpected behavior? (Quote the error message verbatim if possible.)
2. What's the `generateText` / `streamText` call shape? (`prompt` vs `messages`?)
3. Versions: `node -e "console.log(require('./node_modules/@honcho-ai/vercel-ai-sdk/package.json').version)"` and `node -e "console.log(require('./node_modules/ai/package.json').version)"`
4. Is `HONCHO_API_KEY` set? (Don't print the key — just confirm presence.)

```bash
[[ -n "$HONCHO_API_KEY" ]] && echo "key set" || echo "key MISSING"
```

### Phase 2 — Triage

Match symptoms to causes. The first column is what the dev sees; the third column is the fix.

| Symptom | Cause | Fix |
|---|---|---|
| Model output is normal but no memory accumulates across calls | Model not wrapped — `wrapLanguageModel` is missing, so middleware never fires | Wrap the model: `const model = wrapLanguageModel({ model: openai(...), middleware: honcho.middleware({ userId, sessionId }) })`, then pass `model` to `generateText` |
| Code passes `middleware:` directly to `generateText` (from older docs) | `ai@^6` only accepts middleware via `wrapLanguageModel` | Switch to `wrapLanguageModel({ model, middleware })` and pass the wrapped `model`. See Phase 2.2 |
| TypeScript error: `Argument of type 'string' is not assignable to parameter of type 'CoreMessage[]'` | `prompt` and `messages` confused — middleware fires on either, but the call shape must be one or the other | Pick `prompt: string` OR `messages: CoreMessage[]`. Don't pass both. |
| AI's responses leak into "what the user said" memory | `observe_me=True` on the AI peer (default for human peers, wrong for AI) | Set `observe_me=False` on the assistant peer. See [docs.honcho.dev](https://docs.honcho.dev) observation modes |
| AI forgets the conversation between requests in the same chat | `sessionId` not stable across requests — generated fresh each time | Pass a stable per-conversation ID (e.g. `request.chatId`) as `sessionId`. Or omit it and let the provider auto-generate a single ID for the whole instance (single-user only) |
| 401 on first model call | `HONCHO_API_KEY` not in env, or wrong workspace | Confirm `HONCHO_API_KEY` and `HONCHO_WORKSPACE_ID` in `.env` and the deployment config. Check honcho.dev dashboard for the key |
| `Cannot find module '@honcho-ai/sdk'` | Peer dep missing — `@honcho-ai/vercel-ai-sdk` requires `@honcho-ai/sdk` to resolve at runtime | `npm install @honcho-ai/sdk` (or `bun add @honcho-ai/sdk`) |

### Phase 3 — Apply fix

Apply the matched fix from Phase 2. Re-run the failing call. Then run **Phase N — Verification** to confirm.

### Phase 4 — Escalation (if Phase 2 didn't match)

If none of the rows above match, capture the diagnostic info from Phase 1 and open an issue at [github.com/plastic-labs/vercel-ai-sdk-package/issues](https://github.com/plastic-labs/vercel-ai-sdk-package/issues). Include the error verbatim, the call shape, and both versions. Don't guess past this point — the package's maintainers are faster at unfamiliar failure modes.

---

## Phase N — Verification

Both INTEGRATE and DEBUG converge here.

- `wrapLanguageModel({ model, middleware: honcho.middleware({...}) })` is applied to every model passed to `generateText` / `streamText` — middleware errors are non-blocking, so a wrap-less call still returns text. Skipping this is the most common silent failure
- `userId` and `sessionId` come from request context (not hardcoded), unless this is a single-user / script
- The provider is constructed at module scope, not inside the request handler
- Project typecheck passes (`npm run typecheck` or `tsc --noEmit`)
- Optional runtime smoke if `HONCHO_API_KEY` is set:

```ts
// .smoke.mjs (delete after running)
import { generateText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { createHoncho } from "@honcho-ai/vercel-ai-sdk";

const honcho = createHoncho({ defaultAssistantId: "assistant" });
const model = wrapLanguageModel({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({ userId: "smoke-test", sessionId: "smoke-1" }),
});

const { text } = await generateText({ model, prompt: "say hi back in 5 words" });
console.log("MODEL_OUT:", text);
```

```bash
bun .smoke.mjs && rm .smoke.mjs
```

Requires `OPENAI_API_KEY` + `@ai-sdk/openai` (already installed from Phase 0). Bun auto-loads `.env` from cwd; on node use `node --env-file=.env .smoke.mjs`.


---

## Anti-patterns

| Anti-pattern | Correction |
|---|---|
| Wrap the model without checking call shape | `prompt: string` and `messages: CoreMessage[]` are mutually exclusive. Confirm one or the other before editing. |
| Hardcode `userId: "test"` for testing purposes | Persists in the actual file. Use the auth context the dev's app already exposes; don't introduce test fixtures into production code. |
| Construct the provider inside the request handler | Provider holds an in-memory ID cache. Module-scope construction is correct; per-request is not. |
| Insert `import { createHoncho } from "@honcho-ai/vercel-ai-sdk"` without confirming the package is installed | If the import lands in a file before the package is in `package.json`, the build breaks. Confirm `npm install @honcho-ai/vercel-ai-sdk` first. |
| Treat "the call returns text" as success in Phase N | Middleware errors are non-blocking by default — the call returns text whether Honcho fired or not. The verification has to confirm middleware actually ran (logs, dashboard, or smoke script). |
