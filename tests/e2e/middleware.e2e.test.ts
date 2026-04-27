import { describe, it, expect } from 'vitest';
import { generateText, wrapLanguageModel } from 'ai';
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3StreamResult,
} from '@ai-sdk/provider';

import { createHoncho } from '../../src/ai-sdk/index.js';
import {
  hasHonchoCredentials,
  nanoidNamespace,
  withNetworkErrorSkip,
} from '../fixtures/env-guard.js';

interface StubModelHandle {
  model: LanguageModelV3;
  calls: LanguageModelV3CallOptions[];
}

const STUB_USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
} as const;

const STUB_FINISH_REASON = { unified: 'stop', raw: 'stop' } as const;

function createStubModel(text: string): StubModelHandle {
  const calls: LanguageModelV3CallOptions[] = [];

  const model: LanguageModelV3 = {
    specificationVersion: 'v3',
    provider: 'stub',
    modelId: 'stub-model',
    supportedUrls: {},
    async doGenerate(options) {
      calls.push(options);
      const result: LanguageModelV3GenerateResult = {
        content: [{ type: 'text', text }],
        finishReason: { ...STUB_FINISH_REASON },
        usage: structuredClone(STUB_USAGE),
        warnings: [],
      };
      return result;
    },
    async doStream(options) {
      calls.push(options);
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'stream-start', warnings: [] });
          controller.enqueue({ type: 'text-start', id: '0' });
          controller.enqueue({ type: 'text-delta', id: '0', delta: text });
          controller.enqueue({ type: 'text-end', id: '0' });
          controller.enqueue({
            type: 'finish',
            finishReason: { ...STUB_FINISH_REASON },
            usage: structuredClone(STUB_USAGE),
          });
          controller.close();
        },
      });
      const result: LanguageModelV3StreamResult = { stream };
      return result;
    },
  };

  return { model, calls };
}

function findSystemContent(call: LanguageModelV3CallOptions): string {
  const prompt = call.prompt ?? [];
  const system = prompt.find(message => message.role === 'system') as
    | { role: 'system'; content: string }
    | undefined;
  return system?.content ?? '';
}

describe.skipIf(!hasHonchoCredentials())('e2e: middleware against api.honcho.dev', () => {
  it('full conversation flow: persists turns and re-injects into next system prompt', async ctx => {
    await withNetworkErrorSkip(ctx, async () => {
      const userId = nanoidNamespace('test-user');
      const assistantId = nanoidNamespace('test-assistant');
      const sessionId = nanoidNamespace('test-session');

      const honcho = createHoncho();
      const firstReply = 'Acknowledged. Stored your favorite color is teal.';
      const secondReply = 'Yes, you mentioned teal earlier.';

      const firstStub = createStubModel(firstReply);
      const secondStub = createStubModel(secondReply);

      const middleware = honcho.middleware({ userId, sessionId, assistantId });

      const wrapped1 = wrapLanguageModel({ model: firstStub.model, middleware });
      await generateText({
        model: wrapped1,
        prompt: 'My favorite color is teal.',
      });

      const wrapped2 = wrapLanguageModel({ model: secondStub.model, middleware });
      await generateText({
        model: wrapped2,
        prompt: 'What did I just tell you?',
      });

      expect(secondStub.calls).toHaveLength(1);
      const secondSystem = findSystemContent(secondStub.calls[0]);
      expect(secondSystem).toContain('<honcho_recent_messages>');
      expect(secondSystem.toLowerCase()).toContain('teal');

      const session = await honcho.client.session(sessionId);
      const context = await session.context({ peerPerspective: assistantId });
      const openai = context.toOpenAI(assistantId);
      const userTurns = openai.filter(m => m.role === 'user');
      const assistantTurns = openai.filter(m => m.role === 'assistant');
      expect(userTurns.length).toBeGreaterThanOrEqual(1);
      expect(assistantTurns.length).toBeGreaterThanOrEqual(1);
      expect(assistantTurns.map(m => m.content).join(' ')).toContain('teal');
    });
  });

  it('multi-agent same session: messages are attributed per assistantId', async ctx => {
    await withNetworkErrorSkip(ctx, async () => {
      const userId = nanoidNamespace('test-user');
      const assistantA = nanoidNamespace('test-asst-a');
      const assistantB = nanoidNamespace('test-asst-b');
      const sessionId = nanoidNamespace('test-session');

      const honcho = createHoncho();
      const replyA = 'Reply from agent A about apples.';
      const replyB = 'Reply from agent B about bananas.';

      const stubA = createStubModel(replyA);
      const stubB = createStubModel(replyB);

      await generateText({
        model: wrapLanguageModel({
          model: stubA.model,
          middleware: honcho.middleware({ userId, sessionId, assistantId: assistantA }),
        }),
        prompt: 'Agent A, what fruit do you prefer?',
      });

      await generateText({
        model: wrapLanguageModel({
          model: stubB.model,
          middleware: honcho.middleware({ userId, sessionId, assistantId: assistantB }),
        }),
        prompt: 'Agent B, what fruit do you prefer?',
      });

      const session = await honcho.client.session(sessionId);
      const ctxFromA = await session.context({ peerPerspective: assistantA });
      const ctxFromB = await session.context({ peerPerspective: assistantB });

      const openaiFromA = ctxFromA.toOpenAI(assistantA);
      const openaiFromB = ctxFromB.toOpenAI(assistantB);

      const aOwnText = openaiFromA
        .filter(m => m.role === 'assistant')
        .map(m => m.content)
        .join(' ');
      expect(aOwnText).toContain('apples');
      expect(aOwnText).not.toContain('bananas');

      const bOwnText = openaiFromB
        .filter(m => m.role === 'assistant')
        .map(m => m.content)
        .join(' ');
      expect(bOwnText).toContain('bananas');
      expect(bOwnText).not.toContain('apples');

      const aSeesBAsUser = openaiFromA
        .filter(m => m.role === 'user')
        .map(m => m.content)
        .join(' ');
      expect(aSeesBAsUser).toContain('bananas');
    });
  });

  it('round-trip: send + middleware persist, then context().toOpenAI maps roles', async ctx => {
    await withNetworkErrorSkip(ctx, async () => {
      const userId = nanoidNamespace('test-user');
      const assistantId = nanoidNamespace('test-assistant');
      const sessionId = nanoidNamespace('test-session');

      const honcho = createHoncho();

      const directUserMessage = 'Direct message via honcho.send().';
      await honcho.send({ userId, sessionId, content: directUserMessage });

      const assistantReply = 'Assistant reply via middleware.';
      const stub = createStubModel(assistantReply);
      await generateText({
        model: wrapLanguageModel({
          model: stub.model,
          middleware: honcho.middleware({ userId, sessionId, assistantId }),
        }),
        prompt: 'Prompt that triggers a middleware-persisted reply.',
      });

      const session = await honcho.client.session(sessionId);
      const context = await session.context({ peerPerspective: assistantId });
      const openai = context.toOpenAI(assistantId);

      expect(Array.isArray(openai)).toBe(true);
      expect(openai.length).toBeGreaterThanOrEqual(2);
      for (const message of openai) {
        expect(['user', 'assistant', 'system']).toContain(message.role);
      }

      const assistantMessages = openai.filter(m => m.role === 'assistant');
      const userMessages = openai.filter(m => m.role === 'user');
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
      expect(userMessages.length).toBeGreaterThanOrEqual(1);
      expect(assistantMessages.map(m => m.content).join(' ')).toContain(assistantReply);
      expect(userMessages.map(m => m.content).join(' ')).toContain(directUserMessage);
    });
  });
});
