import type Honcho from "@honcho-ai/core";
import { createClient } from "../shared/context.js";
import type { HonchoProviderOptions } from "../types.js";

/**
 * Configuration for the PeerIdentity layer.
 */
export interface PeerIdentityOptions {
  /** Honcho provider options. */
  provider: HonchoProviderOptions;
  /** Peer ID whose identity card to manage. */
  peerId: string;
  /**
   * Target peer ID (whose card to manage from this peer's perspective).
   * If omitted, manages the peer's own self-card.
   */
  targetPeerId?: string;
}

/**
 * A diff describing changes to a peer card.
 */
export interface CardDiff {
  added: string[];
  removed: string[];
  unchanged: string[];
}

/**
 * Snapshot of a peer card at a point in time.
 */
export interface CardSnapshot {
  entries: string[];
  timestamp: string;
  observerPeerId: string;
  targetPeerId: string | null;
}

/**
 * A live identity document backed by Honcho peer cards.
 *
 * Peer cards are structured arrays of biographical facts that Honcho
 * maintains about a peer. This layer provides a document-like interface
 * for reading, writing, and evolving those cards.
 *
 * @example
 * ```ts
 * const identity = await createPeerIdentity({
 *   provider: { workspaceId: "ws-1" },
 *   peerId: "agent-narrator",
 *   targetPeerId: "user-alice",
 * });
 *
 * // Read current card
 * const card = await identity.read();
 * console.log(card); // ["Prefers dark themes", "Speaks English and Spanish"]
 *
 * // Append facts
 * await identity.append(["Works in data science", "Loves hiking"]);
 *
 * // Remove outdated facts
 * await identity.remove(["Speaks English and Spanish"]);
 *
 * // Replace the entire card
 * await identity.replace(["Completely new identity"]);
 *
 * // Merge facts (add only new, deduplicated)
 * const diff = await identity.merge(["Works in data science", "Has a dog"]);
 * console.log(diff.added); // ["Has a dog"]
 *
 * // Take a timestamped snapshot
 * const snapshot = await identity.snapshot();
 * ```
 */
export interface PeerIdentity {
  /** The Honcho client. */
  client: Honcho;
  /** Workspace ID. */
  workspaceId: string;
  /** Observer peer ID. */
  peerId: string;
  /** Target peer ID (null = self-card). */
  targetPeerId: string | null;

  /**
   * Read the current peer card entries.
   * Returns an empty array if no card exists.
   */
  read(): Promise<string[]>;

  /**
   * Replace the entire peer card with new entries.
   */
  replace(entries: string[]): Promise<string[]>;

  /**
   * Append entries to the existing card.
   * Does not deduplicate — use `merge` for that.
   */
  append(entries: string[]): Promise<string[]>;

  /**
   * Remove specific entries from the card (exact match).
   * Returns the updated card.
   */
  remove(entries: string[]): Promise<string[]>;

  /**
   * Merge new entries into the card, skipping exact duplicates.
   * Returns a diff showing what was added vs already present.
   */
  merge(entries: string[]): Promise<CardDiff>;

  /**
   * Check if the card contains a specific entry (exact match).
   */
  has(entry: string): Promise<boolean>;

  /**
   * Search card entries for those containing a substring (case-insensitive).
   */
  search(query: string): Promise<string[]>;

  /**
   * Get the number of entries in the card.
   */
  size(): Promise<number>;

  /**
   * Take a timestamped snapshot of the current card.
   */
  snapshot(): Promise<CardSnapshot>;

  /**
   * Compare the current card to a previous snapshot and return the diff.
   */
  diff(previous: CardSnapshot): Promise<CardDiff>;

  /**
   * Clear all entries from the card.
   */
  clear(): Promise<void>;
}

/**
 * Create a live peer identity document.
 */
export async function createPeerIdentity(
  options: PeerIdentityOptions
): Promise<PeerIdentity> {
  const { provider, peerId } = options;
  const targetPeerId = options.targetPeerId ?? null;
  const client = createClient(provider);
  const workspaceId = provider.workspaceId;

  // Ensure workspace and peer(s) exist
  await client.workspaces.getOrCreate({ id: workspaceId });
  await client.workspaces.peers.getOrCreate(workspaceId, { id: peerId });
  if (targetPeerId) {
    await client.workspaces.peers.getOrCreate(workspaceId, {
      id: targetPeerId,
    });
  }

  const cardParams = targetPeerId ? { target: targetPeerId } : {};

  const identity: PeerIdentity = {
    client,
    workspaceId,
    peerId,
    targetPeerId,

    async read() {
      const response = await client.workspaces.peers
        .card(workspaceId, peerId, cardParams)
        .catch(() => ({ peer_card: null }));
      return response.peer_card ?? [];
    },

    async replace(entries) {
      const response = await client.workspaces.peers.setCard(
        workspaceId,
        peerId,
        {
          peer_card: entries,
          target: targetPeerId ?? undefined,
        }
      );
      return response.peer_card ?? entries;
    },

    async append(entries) {
      const current = await identity.read();
      const updated = [...current, ...entries];
      return identity.replace(updated);
    },

    async remove(entries) {
      const current = await identity.read();
      const removeSet = new Set(entries);
      const updated = current.filter((e) => !removeSet.has(e));
      return identity.replace(updated);
    },

    async merge(entries) {
      const current = await identity.read();
      const currentSet = new Set(current);

      const added: string[] = [];
      const unchanged: string[] = [];

      for (const entry of entries) {
        if (currentSet.has(entry)) {
          unchanged.push(entry);
        } else {
          added.push(entry);
        }
      }

      if (added.length > 0) {
        await identity.replace([...current, ...added]);
      }

      return {
        added,
        removed: [],
        unchanged,
      };
    },

    async has(entry) {
      const current = await identity.read();
      return current.includes(entry);
    },

    async search(query) {
      const current = await identity.read();
      const lower = query.toLowerCase();
      return current.filter((e) => e.toLowerCase().includes(lower));
    },

    async size() {
      const current = await identity.read();
      return current.length;
    },

    async snapshot() {
      const entries = await identity.read();
      return {
        entries,
        timestamp: new Date().toISOString(),
        observerPeerId: peerId,
        targetPeerId,
      };
    },

    async diff(previous) {
      const current = await identity.read();
      const currentSet = new Set(current);
      const previousSet = new Set(previous.entries);

      return {
        added: current.filter((e) => !previousSet.has(e)),
        removed: previous.entries.filter((e) => !currentSet.has(e)),
        unchanged: current.filter((e) => previousSet.has(e)),
      };
    },

    async clear() {
      await identity.replace([]);
    },
  };

  return identity;
}

/**
 * Create peer identity documents for all peers in a workspace
 * observing a single target peer.
 *
 * Useful for seeing how different agents perceive the same user.
 */
export async function createMultiPerspectiveIdentity(
  options: {
    provider: HonchoProviderOptions;
    observerPeerIds: string[];
    targetPeerId: string;
  }
): Promise<Map<string, PeerIdentity>> {
  const identities = new Map<string, PeerIdentity>();

  const results = await Promise.all(
    options.observerPeerIds.map(async (observerId) => {
      const identity = await createPeerIdentity({
        provider: options.provider,
        peerId: observerId,
        targetPeerId: options.targetPeerId,
      });
      return { observerId, identity };
    })
  );

  for (const { observerId, identity } of results) {
    identities.set(observerId, identity);
  }

  return identities;
}

/**
 * Compare how multiple peers perceive the same target.
 * Returns a map of observerId -> card entries, plus entries
 * that appear across all observers (consensus) and entries
 * unique to each observer.
 */
export async function compareIdentityPerspectives(
  identities: Map<string, PeerIdentity>
): Promise<{
  perspectives: Map<string, string[]>;
  consensus: string[];
  unique: Map<string, string[]>;
}> {
  const perspectives = new Map<string, string[]>();

  const results = await Promise.all(
    Array.from(identities.entries()).map(async ([id, identity]) => ({
      id,
      entries: await identity.read(),
    }))
  );

  for (const { id, entries } of results) {
    perspectives.set(id, entries);
  }

  // Find consensus: entries present in ALL perspectives
  const allEntryArrays = Array.from(perspectives.values());
  const consensus =
    allEntryArrays.length > 0
      ? allEntryArrays[0].filter((entry) =>
          allEntryArrays.every((arr) => arr.includes(entry))
        )
      : [];

  // Find unique: entries only in one perspective
  const unique = new Map<string, string[]>();
  const consensusSet = new Set(consensus);

  for (const [id, entries] of perspectives) {
    const otherEntries = new Set(
      Array.from(perspectives.entries())
        .filter(([otherId]) => otherId !== id)
        .flatMap(([, arr]) => arr)
    );

    unique.set(
      id,
      entries.filter((e) => !consensusSet.has(e) && !otherEntries.has(e))
    );
  }

  return { perspectives, consensus, unique };
}
