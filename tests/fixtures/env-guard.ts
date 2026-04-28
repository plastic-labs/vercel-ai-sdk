import { nanoid } from 'nanoid';
import type { TestContext } from 'vitest';

export function hasHonchoCredentials(): boolean {
  return Boolean(process.env.HONCHO_API_KEY && process.env.HONCHO_WORKSPACE_ID);
}

const NETWORK_SKIP_PATTERNS = [
  /ECONNREFUSED/i,
  /ECONNRESET/i,
  /ETIMEDOUT/i,
  /ENOTFOUND/i,
  /EAI_AGAIN/i,
  /fetch failed/i,
];

function isTransientNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { status?: unknown }).status;
  if (typeof status === 'number' && (status >= 500 || status === 429)) {
    return true;
  }
  const name = (err as { name?: unknown }).name;
  if (
    name === 'ServerError' ||
    name === 'RateLimitError' ||
    name === 'ConnectionError' ||
    name === 'TimeoutError'
  ) {
    return true;
  }
  const message = (err as { message?: unknown }).message;
  if (typeof message === 'string') {
    return NETWORK_SKIP_PATTERNS.some(rx => rx.test(message));
  }
  return false;
}

export async function withNetworkErrorSkip<T>(
  ctx: TestContext,
  fn: () => Promise<T>,
): Promise<T | void> {
  try {
    return await fn();
  } catch (err) {
    if (isTransientNetworkError(err)) {
      const detail = err instanceof Error ? err.message : String(err);
      ctx.skip(`transient network error: ${detail}`);
      return;
    }
    throw err;
  }
}

export function nanoidNamespace(prefix: string): string {
  return `${prefix}-${nanoid()}`;
}
