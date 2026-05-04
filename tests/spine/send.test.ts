import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createMockHonchoClient,
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

describe('honcho.send() spine', () => {
  it('saves a single message under userId to the named session', async () => {
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => undefined),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    await honcho.send({ userId: 'u1', sessionId: 's1', content: 'hello-from-user' });

    expect(session.addMessages).toHaveBeenCalledTimes(1);
    const arg = session.addMessages.mock.calls[0]![0] as { peerId: string; content: string };
    expect(arg).toEqual({ peerId: 'u1', content: 'hello-from-user' });
  });

  it('throws when sessionId resolves to null (sessionId: null disables session mode)', async () => {
    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    await expect(
      honcho.send({ userId: 'u1', sessionId: null, content: 'no-session' }),
    ).rejects.toThrow(/session mode/i);
  });

  it('threads explicit assistantId into session setup', async () => {
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => undefined),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    await honcho.send({
      userId: 'u1',
      assistantId: 'a2',
      sessionId: 's1',
      content: 'hi a2',
    });

    const peerIds = sharedClient.current.peer.mock.calls.map((c) => c[0]);
    expect(peerIds).toContain('a2');
    expect(peerIds).not.toContain('assistant');

    expect(session.addPeers).toHaveBeenCalledTimes(1);
    const peerArgs = session.addPeers.mock.calls[0]![0] as Array<
      [{ id: string }, Record<string, unknown>]
    >;
    const ids = peerArgs.map((p) => p[0].id).sort();
    expect(ids).toEqual(['a2', 'u1']);
  });

  it('shares cache entry with middleware when assistantId matches', async () => {
    const session = {
      id: 's1',
      workspaceId: 'mock-workspace',
      context: vi.fn(async () => undefined),
      addMessages: vi.fn(async () => []),
      addPeers: vi.fn(async () => undefined),
    };
    sharedClient.current.session.mockResolvedValue(session);

    const { createHoncho } = await importHoncho();
    const honcho = createHoncho({ workspaceId: 'mock-workspace' });

    await honcho.send({
      userId: 'u1',
      assistantId: 'a2',
      sessionId: 's1',
      content: 'hi',
    });

    honcho.middleware({
      userId: 'u1',
      assistantId: 'a2',
      sessionId: 's1',
    });

    const u1Calls = sharedClient.current.peer.mock.calls.filter(
      (c) => c[0] === 'u1',
    ).length;
    const a2Calls = sharedClient.current.peer.mock.calls.filter(
      (c) => c[0] === 'a2',
    ).length;
    expect(u1Calls).toBe(1);
    expect(a2Calls).toBe(1);
    expect(session.addPeers).toHaveBeenCalledTimes(1);
  });
});
