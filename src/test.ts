/**
 * Live integration test for @honcho-ai/tools
 *
 * Required env vars:
 *   HONCHO_API_KEY       - Your Honcho API key
 *   HONCHO_WORKSPACE_ID  - Workspace ID (or name for getOrCreate)
 *   HONCHO_PEER_ID       - Peer ID to test against
 *   HONCHO_SESSION_ID    - Session ID to test against (optional)
 *
 * Optional (for full generateText test):
 *   OPENAI_API_KEY       - OpenAI key to test with gpt-4o
 *   ANTHROPIC_API_KEY    - Anthropic key to test with Claude
 *
 * Usage:
 *   bun run test
 */

import { createHoncho } from "./ai-sdk/index.js";
import { honchoOpenAITools } from "./openai/index.js";
import { createClient } from "./shared/context.js";

const HONCHO_API_KEY = process.env.HONCHO_API_KEY;
const WORKSPACE_ID = process.env.HONCHO_WORKSPACE_ID;
const PEER_ID = process.env.HONCHO_PEER_ID;
const SESSION_ID = process.env.HONCHO_SESSION_ID;

if (!HONCHO_API_KEY) {
  console.error("HONCHO_API_KEY is required");
  process.exit(1);
}
if (!WORKSPACE_ID) {
  console.error("HONCHO_WORKSPACE_ID is required");
  process.exit(1);
}
if (!PEER_ID) {
  console.error("HONCHO_PEER_ID is required");
  process.exit(1);
}

// ── Test 1: Direct Honcho client ──────────────────────────────────

async function testDirectClient() {
  console.log("\n--- Test 1: Direct Honcho Client ---\n");

  const client = createClient({ apiKey: HONCHO_API_KEY, workspaceId: WORKSPACE_ID! });

  // Verify workspace access
  const workspace = await client.workspaces.getOrCreate({ id: WORKSPACE_ID! });
  console.log("Workspace:", workspace.id);

  // Verify peer access
  const peer = await client.workspaces.peers.getOrCreate(workspace.id, { id: PEER_ID! });
  console.log("Peer:", peer.id);

  // Test peer representation
  try {
    const rep = await client.workspaces.peers.representation(workspace.id, peer.id, {});
    console.log("Representation:", rep.representation?.slice(0, 200) ?? "(empty)");
  } catch (e: any) {
    console.log("Representation:", e.message);
  }

  // Test dialectic chat
  try {
    const chat = await client.workspaces.peers.chat(workspace.id, peer.id, {
      query: "What do you know about this user?",
    });
    console.log("Dialectic chat:", chat.content?.slice(0, 200) ?? "(empty)");
  } catch (e: any) {
    console.log("Dialectic chat:", e.message);
  }

  return workspace.id;
}

// ── Test 2: Vercel AI SDK tools (standalone, no LLM) ──────────────

async function testAISDKTools(workspaceId: string) {
  console.log("\n--- Test 2: Vercel AI SDK Tools (standalone) ---\n");

  const honcho = createHoncho({
    apiKey: HONCHO_API_KEY,
    workspaceId,
    defaultPeerId: PEER_ID,
    defaultSessionId: SESSION_ID,
  });

  const tools = honcho.tools();
  console.log("Available tools:", Object.keys(tools).join(", "));

  // Execute honcho_chat tool directly
  try {
    const chatResult = await tools.honcho_chat.execute!(
      { query: "What are this user's interests?" },
      { toolCallId: "test-1", messages: [], abortSignal: AbortSignal.timeout(30000) }
    );
    console.log("honcho_chat result:", JSON.stringify(chatResult).slice(0, 300));
  } catch (e: any) {
    console.log("honcho_chat error:", e.message);
  }

  // Execute honcho_search tool directly
  try {
    const searchResult = await tools.honcho_search.execute!(
      { query: "hello", limit: 3 },
      { toolCallId: "test-2", messages: [], abortSignal: AbortSignal.timeout(30000) }
    );
    console.log("honcho_search result:", JSON.stringify(searchResult).slice(0, 300));
  } catch (e: any) {
    console.log("honcho_search error:", e.message);
  }

  // Execute honcho_get_representation tool directly
  try {
    const repResult = await tools.honcho_get_representation.execute!(
      {},
      { toolCallId: "test-3", messages: [], abortSignal: AbortSignal.timeout(30000) }
    );
    console.log("honcho_get_representation result:", JSON.stringify(repResult).slice(0, 300));
  } catch (e: any) {
    console.log("honcho_get_representation error:", e.message);
  }

  // Execute honcho_search_conclusions tool directly
  try {
    const conclusionResult = await tools.honcho_search_conclusions.execute!(
      { query: "preferences", limit: 3 },
      { toolCallId: "test-4", messages: [], abortSignal: AbortSignal.timeout(30000) }
    );
    console.log("honcho_search_conclusions result:", JSON.stringify(conclusionResult).slice(0, 300));
  } catch (e: any) {
    console.log("honcho_search_conclusions error:", e.message);
  }
}

// ── Test 3: OpenAI tools format ────────────────────────────────────

async function testOpenAITools(workspaceId: string) {
  console.log("\n--- Test 3: OpenAI Tools Format ---\n");

  const client = createClient({ apiKey: HONCHO_API_KEY, workspaceId: WORKSPACE_ID! });
  const openaiTools = honchoOpenAITools({
    client,
    workspaceId,
    defaultPeerId: PEER_ID,
    defaultSessionId: SESSION_ID,
  });

  console.log("Tool definitions:");
  for (const def of openaiTools.definitions) {
    console.log(`  ${def.function.name}: ${def.function.description.slice(0, 80)}...`);
  }

  // Execute via the executor
  try {
    const result = await openaiTools.execute("honcho_chat", {
      query: "What can you tell me about this user?",
    });
    console.log("OpenAI executor result:", result.slice(0, 300));
  } catch (e: any) {
    console.log("OpenAI executor error:", e.message);
  }
}

// ── Test 4: Full generateText with LLM (if key available) ─────────

async function testWithLLM(workspaceId: string) {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasAnthropic = !!process.env.ANTHROPIC_API_KEY;

  if (!hasOpenAI && !hasAnthropic) {
    console.log("\n--- Test 4: Skipped (no OPENAI_API_KEY or ANTHROPIC_API_KEY) ---\n");
    return;
  }

  console.log("\n--- Test 4: Full generateText with LLM ---\n");

  const { generateText, wrapLanguageModel } = await import("ai");

  const honcho = createHoncho({
    apiKey: HONCHO_API_KEY,
    workspaceId,
    defaultPeerId: PEER_ID,
    defaultSessionId: SESSION_ID,
  });

  let baseModel;
  if (hasAnthropic) {
    const { anthropic } = await import("@ai-sdk/anthropic");
    baseModel = anthropic("claude-haiku-4-5-20251001");
    console.log("Using: Anthropic claude-haiku-4-5-20251001");
  } else {
    const { openai } = await import("@ai-sdk/openai");
    baseModel = openai("gpt-4o-mini");
    console.log("Using: OpenAI gpt-4o-mini");
  }

  // Wrap with middleware
  const model = wrapLanguageModel({
    model: baseModel,
    middleware: honcho.middleware(),
  });

  const { text, steps } = await generateText({
    model,
    tools: honcho.tools(),
    maxSteps: 3,
    providerOptions: {
      honcho: { peerId: PEER_ID, sessionId: SESSION_ID },
    },
    prompt: "What do you know about me? Use your memory tools to find out.",
  });

  console.log("Response:", text || "(empty -- model may not have generated text)");
  console.log("Steps:", steps.length);
  for (const step of steps) {
    if (step.toolCalls?.length) {
      for (const tc of step.toolCalls) {
        const argsStr = tc.args ? JSON.stringify(tc.args).slice(0, 100) : "{}";
        console.log(`  Tool call: ${tc.toolName}(${argsStr})`);
      }
    }
    if (step.toolResults?.length) {
      for (const tr of step.toolResults) {
        const resultStr = tr.result != null ? JSON.stringify(tr.result).slice(0, 150) : "(no result)";
        console.log(`  Tool result: ${tr.toolName} -> ${resultStr}`);
      }
    }
  }
}

// ── Run ────────────────────────────────────────────────────────────

async function main() {
  console.log("=== @honcho-ai/tools Integration Test ===");
  console.log(`Workspace: ${WORKSPACE_ID}`);
  console.log(`Peer: ${PEER_ID}`);
  console.log(`Session: ${SESSION_ID ?? "(none)"}`);

  const workspaceId = await testDirectClient();
  await testAISDKTools(workspaceId);
  await testOpenAITools(workspaceId);
  await testWithLLM(workspaceId);

  console.log("\n=== Done ===");
}

main().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
