// ════════════════════════════════════════════════════════════════════════
// V3.4.5 — Global API Request Limiter
//
// In the sandbox environment, Node.js crashes when too many concurrent
// external HTTP requests are in flight. This module provides a global
// semaphore that limits the number of concurrent external API calls.
//
// Usage:
//   import { limitedFetch } from '@/lib/api-limiter';
//   const res = await limitedFetch(url, options);
//
// This wraps the native fetch() with a concurrency limit.
// ════════════════════════════════════════════════════════════════════════

// Maximum concurrent external HTTP requests
const MAX_CONCURRENT = 3;

// Queue of pending requests
let activeCount = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (activeCount < MAX_CONCURRENT) {
    activeCount++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    queue.push(resolve);
  });
}

function release(): void {
  activeCount--;
  if (queue.length > 0) {
    activeCount++;
    const next = queue.shift()!;
    next();
  }
}

/**
 * Rate-limited fetch — wraps the native fetch() with a concurrency limit.
 * Use this instead of raw fetch() for ALL external API calls.
 */
export async function limitedFetch(
  url: string | URL,
  init?: RequestInit & { timeout?: number },
): Promise<Response> {
  // Extract timeout if provided (non-standard, but convenient)
  const { timeout, ...fetchInit } = init ?? {};

  // Apply timeout via AbortSignal if not already set
  let signal: AbortSignal | undefined;
  if (timeout && timeout > 0) {
    signal = AbortSignal.timeout(timeout);
  } else if (fetchInit.signal) {
    signal = fetchInit.signal;
  }

  await acquire();
  try {
    return await fetch(url, { ...fetchInit, signal });
  } finally {
    release();
  }
}

/**
 * Get current queue stats for debugging
 */
export function getLimiterStats(): { active: number; queued: number; max: number } {
  return { active: activeCount, queued: queue.length, max: MAX_CONCURRENT };
}
