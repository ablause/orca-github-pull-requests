import type { CheckStatus, InboxItem, LinkedItem, MergeMethod, PullRequest } from '../protocol'

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'done'

export function errorText(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message)
  return String(error)
}

const UNITS: [number, string][] = [
  [365 * 24 * 3600, 'year'],
  [30 * 24 * 3600, 'month'],
  [7 * 24 * 3600, 'week'],
  [24 * 3600, 'day'],
  [3600, 'hour'],
  [60, 'minute']
]

/** "3 hours ago", read again on every render the panel's polling causes. */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, (now - new Date(iso).getTime()) / 1000)
  for (const [size, unit] of UNITS) {
    const count = Math.floor(seconds / size)
    if (count >= 1) return `${count} ${unit}${count > 1 ? 's' : ''} ago`
  }
  return 'just now'
}

/** How old the data on screen is: within the minute the seconds matter, since that is the refresh pace. */
export function freshness(at: number, now = Date.now()): string {
  const seconds = Math.floor((now - at) / 1000)
  if (seconds < 5) return 'just now'
  return seconds < 60 ? `${seconds}s ago` : ago(new Date(at).toISOString(), now)
}

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

export function stateOf(pr: Pick<PullRequest, 'state' | 'isDraft'>): { label: string; tone: Tone } {
  if (pr.state === 'MERGED') return { label: 'Merged', tone: 'done' }
  if (pr.state === 'CLOSED') return { label: 'Closed', tone: 'danger' }
  if (pr.isDraft) return { label: 'Draft', tone: 'neutral' }
  return { label: 'Open', tone: 'success' }
}

export const CHECK_LOOK: Record<CheckStatus, { tone: Tone; label: string }> = {
  success: { tone: 'success', label: 'Successful' },
  failure: { tone: 'danger', label: 'Failing' },
  pending: { tone: 'warning', label: 'In progress' },
  queued: { tone: 'warning', label: 'Queued' },
  skipped: { tone: 'neutral', label: 'Skipped' },
  neutral: { tone: 'neutral', label: 'Neutral' },
  cancelled: { tone: 'neutral', label: 'Cancelled' }
}

export const METHOD_LABEL: Record<MergeMethod, string> = {
  SQUASH: 'Squash and merge',
  MERGE: 'Create a merge commit',
  REBASE: 'Rebase and merge'
}

/** GitHub's reaction names, spelled out: written artifacts here carry no emoji. */
export const REACTION_LABEL: Record<string, string> = {
  THUMBS_UP: '+1',
  THUMBS_DOWN: '-1',
  LAUGH: 'Laugh',
  HOORAY: 'Hooray',
  CONFUSED: 'Confused',
  HEART: 'Heart',
  ROCKET: 'Rocket',
  EYES: 'Eyes'
}

export const REVIEW_VERB: Record<string, string> = {
  APPROVED: 'approved these changes',
  CHANGES_REQUESTED: 'requested changes',
  COMMENTED: 'reviewed',
  DISMISSED: 'reviewed (dismissed)'
}

/** The tone of a list row's status dot: what needs action shows first. */
export function rowTone(item: InboxItem): Tone {
  if (item.state === 'MERGED') return 'done'
  if (item.state === 'CLOSED') return 'danger'
  if (item.checks === 'failure') return 'danger'
  if (item.checks === 'pending') return 'warning'
  if (item.isDraft) return 'neutral'
  return 'success'
}

/** A row for what an agent named: where it lives and how it stands, all GitHub was asked about it. */
export function describeLinked(item: LinkedItem): string {
  const state = item.kind === 'pr' ? stateOf(item).label.toLowerCase() : item.state === 'OPEN' ? 'open' : 'closed'
  return `${item.repo.split('/')[1] ?? item.repo}#${item.number}, ${state}`
}

/** What decides the next move comes first: the row is narrow and its end gets cut. */
export function describeRow(item: InboxItem, showRepo: boolean, now = Date.now()): string {
  const parts = [showRepo ? `${item.repo.split('/')[1] ?? item.repo}#${item.number}` : `#${item.number}`]
  if (item.state === 'MERGED') parts.push('merged')
  if (item.state === 'CLOSED' && item.kind === 'pr') parts.push('closed')
  if (item.state === 'OPEN' && item.checks === 'failure') parts.push('checks failing')
  if (item.reviewDecision === 'CHANGES_REQUESTED') parts.push('changes requested')
  if (item.reviewDecision === 'APPROVED') parts.push('approved')
  if (item.isDraft) parts.push('draft')
  parts.push(`by ${item.author}`, ago(item.updatedAt, now))
  if (item.comments) parts.push(plural(item.comments, 'comment'))
  return parts.join(', ')
}
