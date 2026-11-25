import type { InboxItem } from '../protocol'

export function inboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    kind: 'pr',
    repo: 'acme/app',
    number: 42,
    title: 'feat: add the thing',
    url: 'https://github.com/acme/app/pull/42',
    author: 'octocat',
    updatedAt: new Date().toISOString(),
    state: 'OPEN',
    stateReason: null,
    comments: 1,
    isDraft: false,
    headRefName: 'feat/thing',
    sameRepo: true,
    checks: 'failure',
    reviewDecision: null,
    inOrca: true,
    ...overrides
  }
}
