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
  return await import('../../src/ai-sdk/index.js');
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
});
