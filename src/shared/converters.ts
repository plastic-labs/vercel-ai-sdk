import type { HonchoContextData, PeerRoleMap } from "../types.js";

/**
 * Map a peer ID to a human-readable role label.
 */
function peerIdToRole(peerId: string, peerMap: PeerRoleMap): string {
  return peerId === peerMap.assistantPeerId ? "assistant" : "user";
}

/**
 * Format Honcho context data as an XML system prompt with role-aware
 * message labels based on the peer role map.
 *
 * Maps peer_id to [user]/[assistant] labels so the LLM understands
 * who said what in the conversation history.
 */
export function contextToSystemPrompt(
  data: HonchoContextData,
  peerMap: PeerRoleMap
): string {
  const sections: string[] = [];

  if (data.representation) {
    sections.push(
      `<honcho_user_context>\n${data.representation}\n</honcho_user_context>`
    );
  }

  if (data.peerCard && data.peerCard.length > 0) {
    const cardText = data.peerCard.map((entry) => `- ${entry}`).join("\n");
    sections.push(`<honcho_user_card>\n${cardText}\n</honcho_user_card>`);
  }

  if (data.summary) {
    sections.push(
      `<honcho_session_summary>\n${data.summary}\n</honcho_session_summary>`
    );
  }

  if (data.messages && data.messages.length > 0) {
    const lines = data.messages.map((m) => {
      const role = peerIdToRole(m.peer_id, peerMap);
      return `[${role}]: ${m.content}`;
    });
    sections.push(
      `<honcho_recent_messages>\n${lines.join("\n")}\n</honcho_recent_messages>`
    );
  }

  return sections.join("\n\n");
}

/**
 * Convert Honcho context messages to an array of { role, content } objects.
 * Useful for BYOL / Pattern C use cases where callers need raw message arrays.
 */
export function contextToMessages(
  data: HonchoContextData,
  peerMap: PeerRoleMap
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!data.messages) return [];

  return data.messages.map((m) => ({
    role: peerIdToRole(m.peer_id, peerMap) as "user" | "assistant",
    content: m.content,
  }));
}
