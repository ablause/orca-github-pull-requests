import type { PullRequest } from '../protocol.ts'
import { fetchPullRequest } from './pull-request.ts'

const SIZE = 30
/** Without a fingerprint to compare, a page this recent is served as is. */
const UNCHECKED_MS = 30_000

/**
 * Full PR pages, reused while the light probe's fingerprint says GitHub has nothing new: switching
 * back to a worktree costs a cheap probe instead of the large timeline query.
 */
export function pullRequestCache(fingerprintOf: (repo: string, number: number) => string | null) {
  const pages = new Map<string, { fingerprint: string | null; at: number; data: PullRequest }>()
  const inflight = new Map<string, Promise<PullRequest>>()

  function remember(key: string, fingerprint: string | null, data: PullRequest): void {
    pages.delete(key)
    pages.set(key, { fingerprint, at: Date.now(), data })
    if (pages.size > SIZE) pages.delete(pages.keys().next().value!)
  }

  return function get(repo: string, number: number): Promise<PullRequest> {
    const key = `${repo}#${number}`
    const fingerprint = fingerprintOf(repo, number)
    const hit = pages.get(key)
    if (hit && (fingerprint ? hit.fingerprint === fingerprint : Date.now() - hit.at < UNCHECKED_MS)) {
      return Promise.resolve(hit.data)
    }
    let pending = inflight.get(key)
    if (!pending) {
      pending = fetchPullRequest(repo, number)
        .then((data) => {
          remember(key, fingerprint, data)
          return data
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    return pending
  }
}

/** Runs `work` over `items`, at most `limit` at a time. */
export async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<unknown>): Promise<void> {
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!).catch(() => undefined)
  })
  await Promise.all(lanes)
}
