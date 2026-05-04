import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';
import {
  createMockHonchoClient,
  createMockSessionContext,
  mockHonchoModule,
  type MockHonchoClient,
} from '../fixtures/mock-honcho-sdk.js';

const sharedClient: { current: MockHonchoClient } = {
  current: createMockHonchoClient({ workspaceId: 'mock-workspace' }),
};

vi.mock('@honcho-ai/sdk', async () => {
  const base = mockHonchoModule();
  return {
    ...base,
    Honcho: vi.fn(function MockHonchoCtor(this: unknown) {
      return sharedClient.current;
    }),
  };
});

async function importHoncho() {
  return await import('../../src/provider/index.js');
}

beforeEach(() => {
  sharedClient.current = createMockHonchoClient({ workspaceId: 'mock-workspace' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function makeStreamingModel(
  chunks: Array<{ type: string; [key: string]: unknown }>,
): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({ chunks: chunks as never }),
    }),
  });
}

function buildSession() {
  return {
    id: 's1',
    workspaceId: 'mock-workspace',
    context: vi.fn(async () => createMockSessionContext({ sessionId: 's1' })),
    addMessages: vi.fn(async () => []),
    addPeers: vi.fn(async () => undefined),
  };
}

describe('streaming finishReason gate', () => {
  it('persists when finishReason is "stop"', async () => {
    const session = buildSession();
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const model = wrapLanguageModel({
      model: makeStreamingModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-delta', id: 't1', delta: 'hello ' },
        { type: 'text-delta', id: 't1', delta: 'world' },
        {
          type: 'finish',
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          finishReason: { unified: 'stop', raw: 'stop' },
        },
      ]),
      middleware: honcho.middleware({ userId: 'u1', assistantId: 'a1', sessionId: 's1' }),
    });

    const result = streamText({ model, prompt: 'hi' });
    for await (const _ of result.textStream) {
      // drain
    }
    await result.finishReason;

    expect(session.addMessages).toHaveBeenCalledTimes(1);
    const args = session.addMessages.mock.calls[0]![0] as Array<{ peerId: string; content: string }>;
    const assistantMsg = args.find((m) => m.peerId === 'a1');
    expect(assistantMsg?.content).toBe('hello world');
  });

  it('does NOT persist when finishReason is "content-filter"', async () => {
    const session = buildSession();
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const model = wrapLanguageModel({
      model: makeStreamingModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-delta', id: 't1', delta: 'partial' },
        {
          type: 'finish',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          finishReason: { unified: 'content-filter', raw: 'content_filter' },
        },
      ]),
      middleware: honcho.middleware({ userId: 'u1', assistantId: 'a1', sessionId: 's1' }),
    });

    const result = streamText({ model, prompt: 'sensitive' });
    for await (const _ of result.textStream) {
      // drain
    }
    await result.finishReason;

    expect(session.addMessages).not.toHaveBeenCalled();
  });

  it('does NOT persist when stream emits an error chunk', async () => {
    const session = buildSession();
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const model = wrapLanguageModel({
      model: makeStreamingModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-delta', id: 't1', delta: 'partial' },
        { type: 'error', error: new Error('mid-stream failure') },
      ]),
      middleware: honcho.middleware({ userId: 'u1', assistantId: 'a1', sessionId: 's1' }),
    });

    const result = streamText({ model, prompt: 'hi' });
    let drained = false;
    for await (const _ of result.textStream) {
      drained = true;
    }

    const finishReason = await result.finishReason;
    expect(finishReason).toBe('error');
    expect(session.addMessages).not.toHaveBeenCalled();
    expect(drained).toBeDefined();
  });

  it('persists when finishReason is "length" (still a valid completion)', async () => {
    const session = buildSession();
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const model = wrapLanguageModel({
      model: makeStreamingModel([
        { type: 'stream-start', warnings: [] },
        { type: 'text-delta', id: 't1', delta: 'truncated answer' },
        {
          type: 'finish',
          usage: { inputTokens: 1, outputTokens: 100, totalTokens: 101 },
          finishReason: { unified: 'length', raw: 'length' },
        },
      ]),
      middleware: honcho.middleware({ userId: 'u1', assistantId: 'a1', sessionId: 's1' }),
    });

    const result = streamText({ model, prompt: 'long' });
    for await (const _ of result.textStream) {
      // drain
    }
    await result.finishReason;

    expect(session.addMessages).toHaveBeenCalledTimes(1);
  });
});
