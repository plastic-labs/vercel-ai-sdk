/**
 * Live integration script for the flat @honcho-ai/ai-sdk API.
 *
 * Required env:
 * - HONCHO_API_KEY
 * - HONCHO_WORKSPACE_ID
 * - HONCHO_USER_ID (optional, defaults to "test-user")
 *
 * Optional env:
 * - HONCHO_SESSION_ID (defaults to timestamped test session)
 * - OPENAI_API_KEY (enables generateText middleware checks)
 */

import { createHoncho } from "./ai-sdk/index.js";

const WORKSPACE_ID = process.env.HONCHO_WORKSPACE_ID;
const USER_ID = process.env.HONCHO_USER_ID ?? "test-user";
const SESSION_ID = process.env.HONCHO_SESSION_ID ?? `test-session-${Date.now()}`;
const ASSISTANT_ID = "assistant";

if (!process.env.HONCHO_API_KEY) {
  console.error("HONCHO_API_KEY is required");
  process.exit(1);
}

if (!WORKSPACE_ID) {
  console.error("HONCHO_WORKSPACE_ID is required");
  process.exit(1);
}

function printSection(title: string): void {
  console.log(`\n--- ${title} ---\n`);
}

async function runTool<TInput extends Record<string, unknown>>(
  toolName: string,
  execute: (input: TInput) => Promise<unknown>,
  input: TInput
): Promise<void> {
  try {
    const result = await execute(input);
    console.log(`${toolName}:`, JSON.stringify(result).slice(0, 300));
  } catch (error) {
    console.log(`${toolName} error:`, (error as Error).message);
  }
}

async function testTools(honcho: ReturnType<typeof createHoncho>): Promise<void> {
  printSection("Tools (Peer-only)");
  const tools = honcho.tools({ userId: USER_ID });
  console.log("Available:", Object.keys(tools).join(", "));

  await runTool(
    "honcho_chat",
    (input) =>
      tools.honcho_chat.execute!(input, {
        toolCallId: "tools-1",
        messages: [],
        abortSignal: AbortSignal.timeout(30000),
      }),
    { query: "What do you know about this user?" }
  );

  await runTool(
    "honcho_search",
    (input) =>
      tools.honcho_search.execute!(input, {
        toolCallId: "tools-2",
        messages: [],
        abortSignal: AbortSignal.timeout(30000),
      }),
    { query: "focus", limit: 3 }
  );

  await runTool(
    "honcho_context",
    (input) =>
      tools.honcho_context.execute!(input, {
        toolCallId: "tools-3",
        messages: [],
        abortSignal: AbortSignal.timeout(30000),
      }),
    { includeSummary: true, messageLimit: 5 }
  );
}

async function testSessionTools(honcho: ReturnType<typeof createHoncho>): Promise<void> {
  printSection("Tools (Session)");
  await honcho.send({
    userId: USER_ID,
    sessionId: SESSION_ID,
    content: "Hello from honcho.send().",
  });
  console.log("send(): persisted one user message");

  const tools = honcho.tools({
    userId: USER_ID,
    sessionId: SESSION_ID,
    assistantId: ASSISTANT_ID,
  });

  await runTool(
    "honcho_context(session)",
    (input) =>
      tools.honcho_context.execute!(input, {
        toolCallId: "session-tools-1",
        messages: [],
        abortSignal: AbortSignal.timeout(30000),
      }),
    { includeSummary: true, messageLimit: 8 }
  );

  await runTool(
    "honcho_get_representation",
    (input) =>
      tools.honcho_get_representation.execute!(input, {
        toolCallId: "session-tools-2",
        messages: [],
        abortSignal: AbortSignal.timeout(30000),
      }),
    {}
  );
}

async function testMiddleware(honcho: ReturnType<typeof createHoncho>): Promise<void> {
  if (!process.env.OPENAI_API_KEY) {
    printSection("Middleware checks skipped (no OPENAI_API_KEY)");
    return;
  }

  printSection("Middleware (generateText)");

  const { generateText } = await import("ai");
  let openai: any;
  try {
    ({ openai } = await import("@ai-sdk/openai"));
  } catch {
    console.log("Skipping middleware checks: @ai-sdk/openai is not installed");
    return;
  }

  // Context-only (no session)
  const contextOnly = await generateText({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({ userId: USER_ID }),
    prompt: "Say hello in one short sentence.",
  });
  console.log("context-only text:", contextOnly.text.slice(0, 120));

  // Session + persistence
  const withSession = await generateText({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({
      userId: USER_ID,
      sessionId: SESSION_ID,
      assistantId: ASSISTANT_ID,
      persistInput: true,
      injectHistory: true,
    }),
    prompt: "Give one short productivity suggestion.",
  });
  console.log("session text:", withSession.text.slice(0, 120));

  // Session + no input persistence
  const noInputPersist = await generateText({
    model: openai("gpt-4o-mini"),
    middleware: honcho.middleware({
      userId: USER_ID,
      sessionId: SESSION_ID,
      assistantId: ASSISTANT_ID,
      persistInput: false,
      injectHistory: true,
    }),
    prompt: "Give one short reflection prompt.",
  });
  console.log("persistInput=false text:", noInputPersist.text.slice(0, 120));
}

async function inspectSession(honcho: ReturnType<typeof createHoncho>): Promise<void> {
  printSection("Session inspection");
  const session = await honcho.client.session(SESSION_ID);
  const page = await session.messages();
  console.log(`session messages: ${page.items.length} (page 1)`);
}

async function main(): Promise<void> {
  console.log("=== @honcho-ai/ai-sdk flat API integration script ===");
  console.log(`workspace=${WORKSPACE_ID}`);
  console.log(`user=${USER_ID}`);
  console.log(`session=${SESSION_ID}`);

  const honcho = createHoncho({
    apiKey: process.env.HONCHO_API_KEY,
    workspaceId: WORKSPACE_ID,
  });

  await testTools(honcho);
  await testSessionTools(honcho);
  await testMiddleware(honcho);
  await inspectSession(honcho);

  console.log("\n=== Done ===");
}

main().catch((error) => {
  console.error("Test failed:", error);
  process.exit(1);
});
