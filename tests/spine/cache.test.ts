import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
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

function makeAssistantModel(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      warnings: [],
    }),
  });
}

beforeEach(() => {
  sharedClient.current = createMockHonchoClient({ workspaceId: 'mock-workspace' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cache rejection recovery', () => {
  it('peer rejection clears cache so retry re-attempts and succeeds', async () => {
    const realPeer = sharedClient.current.peer.getMockImplementation()!;
    let peerCalls = 0;
    sharedClient.current.peer.mockImplementation(async (id: string) => {
      peerCalls += 1;
      if (peerCalls === 1) {
        throw new Error('transient peer fetch failure');
      }
      return realPeer(id);
    });

    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () =>
        createMockSessionContext({
          sessionId: 's1',
          peerRepresentation: 'recovered-rep',
          peerCard: ['recovered-fact'],
        }),
      ),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const onError1 = vi.fn();
    const captured1: { systemContent?: string } = {};
    const middleware1 = honcho.middleware({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
      onError: onError1,
    });
    const model1 = wrapLanguageModel({
      model: new MockLanguageModelV3({
        doGenerate: async (opts) => {
          const sys = opts.prompt.find((m) => m.role === 'system') as
            | { role: 'system'; content: string }
            | undefined;
          captured1.systemContent = sys?.content ?? '';
          return {
            content: [{ type: 'text', text: 'first' }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            warnings: [],
          };
        },
      }),
      middleware: middleware1,
    });

    const result1 = await generateText({ model: model1, prompt: 'q1' });
    expect(result1.text).toBe('first');
    expect(onError1).toHaveBeenCalled();
    expect(captured1.systemContent).toBe('');

    const captured2: { systemContent?: string } = {};
    const middleware2 = honcho.middleware({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
    });
    const model2 = wrapLanguageModel({
      model: new MockLanguageModelV3({
        doGenerate: async (opts) => {
          const sys = opts.prompt.find((m) => m.role === 'system') as
            | { role: 'system'; content: string }
            | undefined;
          captured2.systemContent = sys?.content ?? '';
          return {
            content: [{ type: 'text', text: 'second' }],
            finishReason: { unified: 'stop', raw: 'stop' },
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            warnings: [],
          };
        },
      }),
      middleware: middleware2,
    });

    const result2 = await generateText({ model: model2, prompt: 'q2' });
    expect(result2.text).toBe('second');
    expect(peerCalls).toBeGreaterThanOrEqual(2);
    expect(captured2.systemContent).toContain('recovered-rep');
    expect(captured2.systemContent).toContain('recovered-fact');
  });

  it('LRU evicts oldest entry when maxCacheEntries is exceeded', async () => {
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => createMockSessionContext({ sessionId: 's1' })),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({
      workspaceId: 'mock-workspace',
      maxCacheEntries: 2,
    });

    async function exercise(userId: string) {
      const middleware = honcho.middleware({
        userId,
        assistantId: 'a1',
        sessionId: 's1',
      });
      await generateText({
        model: wrapLanguageModel({ model: makeAssistantModel('ok'), middleware }),
        prompt: 'hi',
      });
    }

    await exercise('u1');
    await exercise('u2');
    await exercise('u3');

    sharedClient.current.peer.mockClear();
    await exercise('u1');
    const u1RefetchCount = sharedClient.current.peer.mock.calls.filter(
      (c) => c[0] === 'u1',
    ).length;
    expect(u1RefetchCount).toBe(1);
  });

  it('LRU keeps recently-used entries when capacity is reached', async () => {
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => createMockSessionContext({ sessionId: 's1' })),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({
      workspaceId: 'mock-workspace',
      maxCacheEntries: 2,
    });

    async function exercise(userId: string) {
      const middleware = honcho.middleware({
        userId,
        assistantId: 'a1',
        sessionId: 's1',
      });
      await generateText({
        model: wrapLanguageModel({ model: makeAssistantModel('ok'), middleware }),
        prompt: 'hi',
      });
    }

    await exercise('u1');
    await exercise('u2');
    await exercise('u1');
    await exercise('u3');

    sharedClient.current.peer.mockClear();
    await exercise('u1');
    const u1RefetchCount = sharedClient.current.peer.mock.calls.filter(
      (c) => c[0] === 'u1',
    ).length;
    expect(u1RefetchCount).toBe(0);
  });

  it('session rejection clears cache so retry re-attempts and succeeds', async () => {
    let sessionCalls = 0;
    sharedClient.current.session.mockImplementation(async (id: string) => {
      sessionCalls += 1;
      if (sessionCalls === 1) {
        throw new Error('transient session fetch failure');
      }
      return {
        id,
        workspaceId: 'mock-workspace',
        context: vi.fn(async () => createMockSessionContext({ sessionId: id })),
        addMessages: vi.fn(async () => []),
        addPeers: vi.fn(async () => undefined),
      };
    });

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const onError1 = vi.fn();
    const middleware1 = honcho.middleware({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
      onError: onError1,
    });
    const result1 = await generateText({
      model: wrapLanguageModel({
        model: makeAssistantModel('first'),
        middleware: middleware1,
      }),
      prompt: 'q1',
    });
    expect(result1.text).toBe('first');
    expect(onError1).toHaveBeenCalled();

    const result2 = await generateText({
      model: wrapLanguageModel({
        model: makeAssistantModel('second'),
        middleware: honcho.middleware({
          userId: 'u1',
          assistantId: 'a1',
          sessionId: 's1',
        }),
      }),
      prompt: 'q2',
    });
    expect(result2.text).toBe('second');
    expect(sessionCalls).toBeGreaterThanOrEqual(2);
  });
});
