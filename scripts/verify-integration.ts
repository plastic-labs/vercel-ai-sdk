// Phase N smoke test for /honcho-vercel-ai-sdk. Fires one generateText
// call through the wrapped model + asserts Honcho persisted the turn.

import { generateText, wrapLanguageModel } from "ai";
import { openai } from "@ai-sdk/openai";
import { createHoncho } from "@honcho-ai/ai-sdk";

const required = ["HONCHO_API_KEY", "HONCHO_WORKSPACE_ID", "OPENAI_API_KEY"];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`missing env: ${missing.join(", ")}`);
  process.exit(1);
}

const userId = `verify-${Date.now()}`;
const sessionId = `verify-session-${Date.now()}`;

const honcho = createHoncho({
  defaultAssistantId: "assistant",
});

console.log(`firing test call (userId=${userId}, sessionId=${sessionId})...`);

const model = wrapLanguageModel({
  model: openai("gpt-4o-mini"),
  middleware: honcho.middleware({ userId, sessionId }),
});

const { text } = await generateText({
  model,
  prompt: "Say the word 'verified' and nothing else.",
});

if (!text || text.trim().length === 0) {
  console.error("model returned empty text");
  process.exit(1);
}

console.log(`model responded: ${text.trim().slice(0, 80)}`);

// Honcho persistence check — read back via the client.
const session = await honcho.client.session(sessionId);
const page = await session.messages();
const count = page.items.length;

if (count < 2) {
  console.error(`expected >=2 messages persisted, got ${count}`);
  process.exit(1);
}

console.log(`honcho persisted ${count} messages`);
console.log("verification OK");
