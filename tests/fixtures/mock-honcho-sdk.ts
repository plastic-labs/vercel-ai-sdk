import { vi } from 'vitest';

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

export interface MockMessage {
  peerId: string;
  content: string;
}

export interface MockSummary {
  content: string;
}

export class MockSessionContext {
  sessionId: string;
  messages: MockMessage[];
  summary: MockSummary | null;
  peerRepresentation: string | null;
  peerCard: string[] | null;

  constructor(
    sessionId: string,
    messages: MockMessage[] = [],
    summary: MockSummary | null = null,
    peerRepresentation: string | null = null,
    peerCard: string[] | null = null,
  ) {
    this.sessionId = sessionId;
    this.messages = messages;
    this.summary = summary;
    this.peerRepresentation = peerRepresentation;
    this.peerCard = peerCard;
  }

  toOpenAI(assistant: string | { id: string }): Array<{ role: string; content: string; name?: string }> {
    const assistantId = typeof assistant === 'string' ? assistant : assistant.id;
    return this.messages.map((m) => ({
      role: m.peerId === assistantId ? 'assistant' : 'user',
      name: m.peerId,
      content: m.content,
    }));
  }

  toAnthropic(assistant: string | { id: string }): Array<{ role: string; content: string }> {
    const assistantId = typeof assistant === 'string' ? assistant : assistant.id;
    return this.messages.map((m) => ({
      role: m.peerId === assistantId ? 'assistant' : 'user',
      content: m.content,
    }));
  }
}

export interface MockHonchoClient {
  workspaceId: string;
  peer: ReturnType<typeof vi.fn>;
  session: ReturnType<typeof vi.fn>;
}

export interface MockSessionContextOverrides {
  sessionId?: string;
  messages?: MockMessage[];
  summary?: MockSummary | null;
  peerRepresentation?: string | null;
  peerCard?: string[] | null;
}

export function createMockSessionContext(
  overrides: MockSessionContextOverrides = {},
): MockSessionContext {
  return new MockSessionContext(
    overrides.sessionId ?? 'mock-session',
    overrides.messages ?? [],
    overrides.summary ?? null,
    overrides.peerRepresentation ?? null,
    overrides.peerCard ?? null,
  );
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
}

export function createMockHonchoClient(
  options: MockHonchoOptions = {},
): MockHonchoClient {
  const workspaceId = options.workspaceId ?? 'mock-workspace';
  const peers = new Map<string, MockPeer>();
  const sessions = new Map<string, MockSession>();

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
    SessionContext: MockSessionContext,
  };
}
