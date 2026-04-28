import { Honcho } from "@honcho-ai/sdk";
import type { HonchoProviderOptions } from "../types.js";

const IMPLICIT_WORKSPACE_ID = "vercel-ai-sdk";
let hasWarnedDefaultWorkspace = false;

/**
 * Resolve workspace ID from options/env with implicit fallback.
 *
 * Resolution order: `options.workspaceId` -> `HONCHO_WORKSPACE_ID` env ->
 * the literal `"vercel-ai-sdk"` constant. The fallback emits a one-time
 * `console.warn` (warn-once per process) so first-run usage just works.
 * Production callers should set `workspaceId` or `HONCHO_WORKSPACE_ID`
 * explicitly to avoid sharing the implicit workspace across projects.
 */
export function resolveWorkspaceId(options: HonchoProviderOptions = {}): string {
  const workspaceId = options.workspaceId ?? process.env.HONCHO_WORKSPACE_ID;
  if (workspaceId) {
    return workspaceId;
  }

  if (!hasWarnedDefaultWorkspace) {
    console.warn(
      `[honcho] No workspace ID provided. Falling back to workspace "${IMPLICIT_WORKSPACE_ID}".`
    );
    hasWarnedDefaultWorkspace = true;
  }

  return IMPLICIT_WORKSPACE_ID;
}

/**
 * Create a Honcho SDK client.
 */
export function createClient(options: HonchoProviderOptions = {}): Honcho {
  return new Honcho({
    apiKey: options.apiKey,
    workspaceId: resolveWorkspaceId(options),
    environment: options.environment,
    baseURL: options.baseURL,
    timeout: options.timeout,
    maxRetries: options.maxRetries,
    defaultHeaders: options.defaultHeaders,
  });
}
