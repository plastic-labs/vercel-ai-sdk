import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV3 } from 'ai/test';
import {
  createMockHonchoClient,
  createMockSessionContext,
  mockHonchoModule,
  type MockHonchoClient,
  type MockPeer,
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
  return await import('../../src/ai-sdk/index.js');
}

beforeEach(() => {
  sharedClient.current = createMockHonchoClient({ workspaceId: 'mock-workspace' });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('honcho.tools() spine', () => {
  it('standalone (no middleware): returns 6 named tools, honcho_chat hits peer.chat', async () => {
    const chat = vi.fn(async () => 'mocked-chat-response');
    const peers = new Map<string, MockPeer>();
    sharedClient.current.peer.mockImplementation(async (id: string) => {
      const existing = peers.get(id);
      if (existing) return existing;
      const peer: MockPeer = {
        id,
        workspaceId: 'mock-workspace',
        chat,
        search: vi.fn(async () => []),
        context: vi.fn(async () => ({
          peerId: id,
          targetId: id,
          representation: null,
          peerCard: null,
        })),
        representation: vi.fn(async () => ''),
        message: vi.fn((content: string) => ({ peerId: id, content })),
        conclusionsOf: vi.fn(() => ({ query: vi.fn(async () => []), create: vi.fn(async () => undefined) })),
      };
      peers.set(id, peer);
      return peer;
    });

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });
    const tools = honcho.tools({ userId: 'u1', sessionId: null });

    const expectedKeys = [
      'honcho_chat',
      'honcho_context',
      'honcho_search',
      'honcho_search_conclusions',
      'honcho_get_representation',
      'honcho_save_conclusion',
    ] as const;
    for (const key of expectedKeys) {
      expect(tools).toHaveProperty(key);
    }

    const result = await tools.honcho_chat.execute!(
      { query: 'what does u1 like?' },
      { toolCallId: 't1', messages: [], abortSignal: AbortSignal.timeout(1000) },
    );

    expect(chat).toHaveBeenCalledTimes(1);
    expect(chat).toHaveBeenCalledWith('what does u1 like?', expect.objectContaining({ target: 'u1' }));
    expect(result).toEqual({ content: 'mocked-chat-response' });
  });

  it('with middleware: tool step does not inflate addMessages count', async () => {
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => createMockSessionContext({ sessionId: 's1' })),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    let step = 0;
    const baseModel = new MockLanguageModelV3({
      doGenerate: async () => {
        step += 1;
        if (step === 1) {
          return {
            content: [
              {
                type: 'tool-call',
                toolCallId: 'tc-1',
                toolName: 'honcho_chat',
                input: JSON.stringify({ query: 'what?' }),
              },
            ],
            finishReason: 'tool-calls',
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            warnings: [],
          };
        }
        return {
          content: [{ type: 'text', text: 'final-answer' }],
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        };
      },
    });

    const middleware = honcho.middleware({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
    });
    const tools = honcho.tools({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
    });
    const model = wrapLanguageModel({ model: baseModel, middleware });

    await generateText({
      model,
      tools,
      stopWhen: ({ steps }) => steps.length >= 2,
      prompt: 'tell me about u1',
    });

    const totalCalls = session.addMessages.mock.calls.length;
    expect(totalCalls).toBeLessThanOrEqual(2);
    const allMessages = session.addMessages.mock.calls.flatMap(
      (c) => c[0] as Array<{ peerId: string; content: string }>,
    );
    const assistantTextSaves = allMessages.filter(
      (m) => m.peerId === 'a1' && m.content === 'final-answer',
    );
    expect(assistantTextSaves).toHaveLength(1);
  });
});
