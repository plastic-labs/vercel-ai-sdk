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
  const mod = await import('../../src/ai-sdk/index.js');
  return mod;
}

function makeAssistantModel(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: 'stop',
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

describe('honcho middleware spine', () => {
  it('context-only (no sessionId): pulls peer.context, no session.addMessages', async () => {
    const userPeerContext = vi.fn(async () => ({
      peerId: 'u1',
      targetId: 'u1',
      representation: 'rep-u1',
      peerCard: ['fact-1'],
    }));
    sharedClient.current.peer.mockImplementation(async (id: string) => ({
      id,
      workspaceId: 'mock-workspace',
      chat: vi.fn(async () => ''),
      search: vi.fn(async () => []),
      context: userPeerContext,
      representation: vi.fn(async () => ''),
      message: vi.fn((content: string) => ({ peerId: id, content })),
      conclusionsOf: vi.fn(() => ({ query: vi.fn(async () => []), create: vi.fn(async () => undefined) })),
    }));

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });
    const middleware = honcho.middleware({ userId: 'u1', sessionId: null });

    const captured: { systemContent?: string } = {};
    const baseModel = new MockLanguageModelV3({
      doGenerate: async (opts) => {
        const sys = opts.prompt.find((m) => m.role === 'system') as
          | { role: 'system'; content: string }
          | undefined;
        captured.systemContent = sys?.content ?? '';
        return {
          content: [{ type: 'text', text: 'ok' }],
          finishReason: 'stop',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          warnings: [],
        };
      },
    });
    const model = wrapLanguageModel({ model: baseModel, middleware });

    await generateText({ model, prompt: 'hello' });

    expect(userPeerContext).toHaveBeenCalledTimes(1);
    expect(sharedClient.current.session).not.toHaveBeenCalled();
    expect(captured.systemContent).toContain('<honcho_user_context>');
    expect(captured.systemContent).toContain('<honcho_user_card>');
  });

  it('with-session output persistence: addMessages called with user + assistant', async () => {
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
    const middleware = honcho.middleware({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
    });
    const model = wrapLanguageModel({
      model: makeAssistantModel('hi back'),
      middleware,
    });

    await generateText({ model, prompt: 'hi' });

    expect(session.addMessages).toHaveBeenCalledTimes(1);
    const args = session.addMessages.mock.calls[0]![0] as Array<{ peerId: string; content: string }>;
    expect(args).toHaveLength(2);
    expect(args[0]).toEqual({ peerId: 'u1', content: 'hi' });
    expect(args[1]).toEqual({ peerId: 'a1', content: 'hi back' });
  });

  it('persistInput: true (default): user message included in addMessages payload', async () => {
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
    const middleware = honcho.middleware({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
    });
    const model = wrapLanguageModel({
      model: makeAssistantModel('reply'),
      middleware,
    });

    await generateText({ model, prompt: 'user question' });

    const args = session.addMessages.mock.calls[0]![0] as Array<{ peerId: string; content: string }>;
    const userMsg = args.find((m) => m.peerId === 'u1');
    expect(userMsg).toBeDefined();
    expect(userMsg?.content).toBe('user question');
  });

  it('persistInput: false: user message NOT saved, only assistant output', async () => {
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
    const middleware = honcho.middleware({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
      persistInput: false,
    });
    const model = wrapLanguageModel({
      model: makeAssistantModel('only-assistant'),
      middleware,
    });

    await generateText({ model, prompt: 'user question' });

    const args = session.addMessages.mock.calls[0]![0] as Array<{ peerId: string; content: string }>;
    expect(args).toHaveLength(1);
    expect(args[0]).toEqual({ peerId: 'a1', content: 'only-assistant' });
    expect(args.some((m) => m.peerId === 'u1')).toBe(false);
  });

  it('injectHistory: true (default): formatter sees history messages from SessionContext', async () => {
    const ctx = createMockSessionContext({
      sessionId: 's1',
      messages: [
        { peerId: 'u1', content: 'previous user' },
        { peerId: 'a1', content: 'previous assistant' },
      ],
      peerRepresentation: 'rep-block',
    });
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => ctx),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const captured: { systemContent?: string } = {};
    const baseModel = new MockLanguageModelV3({
      doGenerate: async (opts) => {
        const sys = opts.prompt.find((m) => m.role === 'system') as
          | { role: 'system'; content: string }
          | undefined;
        captured.systemContent = sys?.content ?? '';
        return {
          content: [{ type: 'text', text: 'r' }],
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
    const model = wrapLanguageModel({ model: baseModel, middleware });

    await generateText({ model, prompt: 'now' });

    expect(captured.systemContent).toContain('<honcho_recent_messages>');
    expect(captured.systemContent).toContain('previous user');
    expect(captured.systemContent).toContain('previous assistant');
  });

  it('injectHistory: false: formatter receives empty messages, but representation/card/summary still flow', async () => {
    const ctx = createMockSessionContext({
      sessionId: 's1',
      messages: [
        { peerId: 'u1', content: 'should not appear' },
        { peerId: 'a1', content: 'also should not appear' },
      ],
      peerRepresentation: 'rep-still-here',
      peerCard: ['card-line'],
      summary: { content: 'session-summary' },
    });
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => ctx),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const captured: { systemContent?: string } = {};
    const baseModel = new MockLanguageModelV3({
      doGenerate: async (opts) => {
        const sys = opts.prompt.find((m) => m.role === 'system') as
          | { role: 'system'; content: string }
          | undefined;
        captured.systemContent = sys?.content ?? '';
        return {
          content: [{ type: 'text', text: 'r' }],
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
      injectHistory: false,
    });
    const model = wrapLanguageModel({ model: baseModel, middleware });

    await generateText({ model, prompt: 'now' });

    expect(captured.systemContent).not.toContain('<honcho_recent_messages>');
    expect(captured.systemContent).not.toContain('should not appear');
    expect(captured.systemContent).toContain('rep-still-here');
    expect(captured.systemContent).toContain('card-line');
    expect(captured.systemContent).toContain('session-summary');
  });

  it('multi-peer: same session, distinct assistantIds, two ensureResources promises', async () => {
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

    const m1 = honcho.middleware({ userId: 'u1', assistantId: 'a1', sessionId: 's1' });
    const m2 = honcho.middleware({ userId: 'u1', assistantId: 'a2', sessionId: 's1' });

    const model1 = wrapLanguageModel({ model: makeAssistantModel('r1'), middleware: m1 });
    const model2 = wrapLanguageModel({ model: makeAssistantModel('r2'), middleware: m2 });

    await generateText({ model: model1, prompt: 'q' });
    await generateText({ model: model2, prompt: 'q' });

    const peerIds = sharedClient.current.peer.mock.calls.map((c) => c[0]);
    expect(peerIds).toContain('a1');
    expect(peerIds).toContain('a2');
    const a1Calls = peerIds.filter((id) => id === 'a1').length;
    const a2Calls = peerIds.filter((id) => id === 'a2').length;
    expect(a1Calls).toBe(1);
    expect(a2Calls).toBe(1);
  });

  it('messages-array no-duplication: caller-provided messages + injectHistory:false leaves history alone', async () => {
    const ctx = createMockSessionContext({
      sessionId: 's1',
      messages: [{ peerId: 'u1', content: 'old-history-leak' }],
      peerRepresentation: 'rep',
    });
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => ctx),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const captured: { promptRoles?: string[]; promptContents?: string[] } = {};
    const baseModel = new MockLanguageModelV3({
      doGenerate: async (opts) => {
        captured.promptRoles = opts.prompt.map((m) => m.role);
        captured.promptContents = opts.prompt.map((m) =>
          typeof (m as { content?: unknown }).content === 'string'
            ? ((m as { content: string }).content)
            : JSON.stringify((m as { content: unknown }).content),
        );
        return {
          content: [{ type: 'text', text: 'r' }],
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
      injectHistory: false,
    });
    const model = wrapLanguageModel({ model: baseModel, middleware });

    await generateText({
      model,
      messages: [
        { role: 'user', content: 'turn-1-user' },
        { role: 'assistant', content: 'turn-1-assistant' },
        { role: 'user', content: 'turn-2-user' },
      ],
    });

    const userTurns = (captured.promptContents ?? []).filter((c) => c.includes('turn-1-user')).length;
    expect(userTurns).toBe(1);
    const fullPrompt = (captured.promptContents ?? []).join('\n');
    expect(fullPrompt).not.toContain('old-history-leak');
  });

  it('invariant: onError is called when addMessages rejects; result still resolves', async () => {
    const persistError = new Error('persistence failed');
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => createMockSessionContext({ sessionId: 's1' })),
      addMessages: vi.fn(async () => {
        throw persistError;
      }),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    const onError = vi.fn();
    const middleware = honcho.middleware({
      userId: 'u1',
      assistantId: 'a1',
      sessionId: 's1',
      onError,
    });
    const model = wrapLanguageModel({
      model: makeAssistantModel('survived'),
      middleware,
    });

    const result = await generateText({ model, prompt: 'hi' });

    expect(result.text).toBe('survived');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(persistError);
  });

  it('invariant: cache-key collision shares userPeerPromise across two middleware() calls', async () => {
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

    const m1 = honcho.middleware({ userId: 'u1', assistantId: 'a1', sessionId: 's1' });
    const m2 = honcho.middleware({ userId: 'u1', assistantId: 'a1', sessionId: 's1' });

    const model1 = wrapLanguageModel({ model: makeAssistantModel('r1'), middleware: m1 });
    const model2 = wrapLanguageModel({ model: makeAssistantModel('r2'), middleware: m2 });

    await generateText({ model: model1, prompt: 'q' });
    await generateText({ model: model2, prompt: 'q' });

    const peerIds = sharedClient.current.peer.mock.calls.map((c) => c[0]);
    const u1Count = peerIds.filter((id) => id === 'u1').length;
    const a1Count = peerIds.filter((id) => id === 'a1').length;
    expect(u1Count).toBe(1);
    expect(a1Count).toBe(1);
  });
});
