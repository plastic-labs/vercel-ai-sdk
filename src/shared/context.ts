import { Honcho } from "@honcho-ai/sdk";
import type { HonchoProviderOptions } from "../types.js";

let hasWarnedDefaultWorkspace = false;

/**
 * Resolve workspace ID from options/env and fail fast when missing.
 */
export function resolveWorkspaceId(options: HonchoProviderOptions = {}): string {
  const workspaceId = options.workspaceId ?? process.env.HONCHO_WORKSPACE_ID;
  if (workspaceId) {
    return workspaceId;
  }

  if (options.allowDefaultWorkspace) {
    if (!hasWarnedDefaultWorkspace) {
      console.warn(
        '[honcho] No workspace ID provided. Falling back to workspace "default".'
      );
      hasWarnedDefaultWorkspace = true;
    }
    return "default";
  }

  if (!workspaceId) {
    throw new Error(
      "Missing Honcho workspace ID. Set HONCHO_WORKSPACE_ID or pass workspaceId to createHoncho()."
    );
  }
  return workspaceId;
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
