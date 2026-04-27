import { vi } from 'vitest';

export interface MockConclusions {
  query: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

export interface MockPeer {
  id: string;
  workspaceId: string;
  chat: ReturnType<typeof vi.fn>;
  search: ReturnType<typeof vi.fn>;
  context: ReturnType<typeof vi.fn>;
  representation: ReturnType<typeof vi.fn>;
  message: ReturnType<typeof vi.fn>;
  conclusionsOf: ReturnType<typeof vi.fn>;
}

export interface MockSession {
  id: string;
  workspaceId: string;
  context: ReturnType<typeof vi.fn>;
  addMessages: ReturnType<typeof vi.fn>;
  addPeers: ReturnType<typeof vi.fn>;
}

export interface MockSessionContext {
  sessionId: string;
  messages: unknown[];
  toOpenAI: ReturnType<typeof vi.fn>;
  toAnthropic: ReturnType<typeof vi.fn>;
}

export interface MockHonchoClient {
  workspaceId: string;
  peer: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof vi.fn>;
}

export function createMockSessionContext(
  overrides: Partial<MockSessionContext> = {},
): MockSessionContext {
  return {
    sessionId: overrides.sessionId ?? 'mock-session',
    messages: overrides.messages ?? [],
    toOpenAI: overrides.toOpenAI ?? vi.fn(() => []),
    toAnthropic: overrides.toAnthropic ?? vi.fn(() => []),
  };
}

export function createMockPeer(
  id: string,
  overrides: Partial<MockPeer> = {},
): MockPeer {
  return {
    id,
    workspaceId: overrides.workspaceId ?? 'mock-workspace',
    chat: overrides.chat ?? vi.fn(async () => ''),
    search: overrides.search ?? vi.fn(async () => []),
    context: overrides.context ?? vi.fn(async () => ({
      peerId: id,
      targetId: id,
      representation: null,
      peerCard: null,
    })),
    representation: overrides.representation ?? vi.fn(async () => ''),
    message: overrides.message ?? vi.fn((content: string) => ({
      peerId: id,
      content,
    })),
    conclusionsOf: overrides.conclusionsOf ?? vi.fn((_targetId: string) => ({
      query: vi.fn(async () => []),
      create: vi.fn(async () => undefined),
    })),
  };
}

export function createMockSession(
  id: string,
  overrides: Partial<MockSession> = {},
): MockSession {
  return {
    id,
    workspaceId: overrides.workspaceId ?? 'mock-workspace',
    context: overrides.context ?? vi.fn(async () => createMockSessionContext({ sessionId: id })),
    addMessages: overrides.addMessages ?? vi.fn(async () => []),
    addPeers: overrides.addPeers ?? vi.fn(async () => undefined),
  };
}

export interface MockHonchoOptions {
  workspaceId?: string;
  peers?: Map<string, MockPeer>;
  sessions?: Map<string, MockSession>;
}

export function createMockHonchoClient(
  options: MockHonchoOptions = {},
): MockHonchoClient {
  const workspaceId = options.workspaceId ?? 'mock-workspace';
  const peers = options.peers ?? new Map<string, MockPeer>();
  const sessions = options.sessions ?? new Map<string, MockSession>();

  return {
    workspaceId,
    peer: vi.fn(async (id: string) => {
      let peer = peers.get(id);
      if (!peer) {
        peer = createMockPeer(id, { workspaceId });
        peers.set(id, peer);
      }
      return peer;
    }),
    session: vi.fn(async (id: string) => {
      let session = sessions.get(id);
      if (!session) {
        session = createMockSession(id, { workspaceId });
        sessions.set(id, session);
      }
      return session;
    }),
  };
}

export function mockHonchoModule() {
  return {
    Honcho: vi.fn().mockImplementation((opts: { workspaceId?: string } = {}) =>
      createMockHonchoClient({ workspaceId: opts.workspaceId }),
    ),
  };
}
