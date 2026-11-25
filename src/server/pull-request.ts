import type {
  Actor,
  ChangedFile,
  LinkedItem,
  Check,
  CheckStatus,
  Commit,
  MergeMethod,
  PullRequest,
  Reaction,
  Thread,
  TimelineEntry
} from '../protocol.ts'
import { gh, GhError, graphql } from './gh.ts'
import { PULL_REQUEST_QUERY } from './query.ts'

// GraphQL payloads are mapped field by field below
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any

/** GitHub's rendered HTML, which the panel sanitizes again before drawing it. */
export const html = (value: string | null | undefined) => value?.trim() ?? ''

export const actorOf = (raw: Raw): Actor => ({ login: raw?.login ?? 'ghost', avatarUrl: raw?.avatarUrl ?? null })

export const reactionsOf = (groups: Raw[] | undefined): Reaction[] =>
  (groups ?? [])
    .filter((group) => group.reactors.totalCount > 0)
    .map((group) => ({ content: group.content, count: group.reactors.totalCount, mine: group.viewerHasReacted }))

const CONCLUSION_STATUS: Record<string, CheckStatus> = {
  SUCCESS: 'success',
  SKIPPED: 'skipped',
  NEUTRAL: 'neutral',
  CANCELLED: 'cancelled'
}

/** Running and waiting read differently on GitHub: a spinner for one, a still dot for the other. */
function checkRunStatus(status: string, conclusion: string | null): CheckStatus {
  if (status === 'IN_PROGRESS') return 'pending'
  if (status !== 'COMPLETED') return 'queued'
  return CONCLUSION_STATUS[conclusion ?? ''] ?? 'failure'
}

const words = (value: string) => value.toLowerCase().replace(/_/g, ' ')

function checkOf(raw: Raw): Check {
  if (raw.__typename === 'StatusContext') {
    const status: CheckStatus =
      raw.state === 'SUCCESS' ? 'success' : raw.state === 'FAILURE' || raw.state === 'ERROR' ? 'failure' : 'queued'
    return {
      name: raw.context,
      workflow: null,
      status,
      url: raw.targetUrl ?? null,
      description: raw.description ?? null
    }
  }
  const conclusion: string | null = raw.conclusion
  return {
    name: raw.name,
    workflow: raw.checkSuite?.workflowRun?.workflow?.name ?? null,
    status: checkRunStatus(raw.status, conclusion),
    url: raw.detailsUrl ?? null,
    description: words(conclusion ?? raw.status)
  }
}

function threadOf(raw: Raw): Thread {
  const comments = raw.comments.nodes as Raw[]
  return {
    id: raw.id,
    path: raw.path,
    line: raw.line ?? null,
    isResolved: raw.isResolved,
    isOutdated: raw.isOutdated,
    diffHunk: comments[0]?.diffHunk ?? '',
    comments: comments.map((comment) => ({
      id: comment.id,
      author: actorOf(comment.author),
      body: html(comment.bodyHTML),
      createdAt: comment.createdAt,
      reactions: reactionsOf(comment.reactionGroups)
    }))
  }
}

function eventOf(raw: Raw): TimelineEntry | null {
  const base = {
    kind: 'event' as const,
    id: raw.id as string,
    actor: (raw.actor?.login as string | undefined) ?? null,
    createdAt: raw.createdAt as string,
    label: null,
    link: null
  }
  switch (raw.__typename) {
    case 'HeadRefForcePushedEvent':
      return {
        ...base,
        tone: 'muted',
        text: `force-pushed the branch from ${raw.beforeCommit?.abbreviatedOid ?? '?'} to ${raw.afterCommit?.abbreviatedOid ?? '?'}`
      }
    case 'LabeledEvent':
      return { ...base, tone: 'muted', text: 'added the label', label: raw.label?.name ?? null }
    case 'UnlabeledEvent':
      return { ...base, tone: 'muted', text: 'removed the label', label: raw.label?.name ?? null }
    case 'ReviewRequestedEvent':
      return {
        ...base,
        tone: 'muted',
        text: `requested a review from ${raw.requestedReviewer?.login ?? raw.requestedReviewer?.name ?? 'someone'}`
      }
    case 'AssignedEvent':
      return {
        ...base,
        tone: 'muted',
        text:
          raw.assignee?.login === raw.actor?.login
            ? 'self-assigned this'
            : `assigned ${raw.assignee?.login ?? 'someone'}`
      }
    case 'RenamedTitleEvent':
      return { ...base, tone: 'muted', text: `changed the title from "${raw.previousTitle}" to "${raw.currentTitle}"` }
    case 'ReadyForReviewEvent':
      return { ...base, tone: 'open', text: 'marked this pull request as ready for review' }
    case 'ConvertToDraftEvent':
      return { ...base, tone: 'draft', text: 'marked this pull request as draft' }
    case 'MergedEvent':
      return {
        ...base,
        tone: 'merged',
        text: `merged commit ${raw.commit?.abbreviatedOid ?? ''} into ${raw.mergeRefName}`
      }
    case 'ClosedEvent': {
      const closer = raw.closer?.url
        ? {
            title: raw.closer.number ? `${raw.closer.title} #${raw.closer.number}` : raw.closer.abbreviatedOid,
            url: raw.closer.url
          }
        : null
      if (raw.stateReason === 'NOT_PLANNED') return { ...base, tone: 'not-planned', text: 'closed this as not planned' }
      if (raw.stateReason === 'COMPLETED' || raw.stateReason === 'DUPLICATE') {
        return {
          ...base,
          tone: 'completed',
          text: closer ? 'closed this as completed in' : 'closed this as completed',
          link: closer
        }
      }
      return { ...base, tone: 'closed', text: 'closed this' }
    }
    case 'ConnectedEvent':
      return raw.subject?.url
        ? {
            ...base,
            tone: 'muted',
            text: 'linked a pull request that will close this issue',
            link: { title: `${raw.subject.title} #${raw.subject.number}`, url: raw.subject.url }
          }
        : null
    case 'ReopenedEvent':
      return { ...base, tone: 'open', text: 'reopened this' }
    case 'HeadRefDeletedEvent':
      return { ...base, tone: 'muted', text: 'deleted the branch' }
    case 'AutoMergeEnabledEvent':
      return { ...base, tone: 'muted', text: 'enabled auto-merge' }
    case 'AutoMergeDisabledEvent':
      return { ...base, tone: 'muted', text: 'disabled auto-merge' }
    case 'CrossReferencedEvent':
      return raw.source?.url
        ? {
            ...base,
            tone: 'muted',
            text: 'mentioned this in',
            link: { title: `${raw.source.title} #${raw.source.number}`, url: raw.source.url }
          }
        : null
    default:
      return null
  }
}

export function timelineOf(nodes: Raw[], threadsByReview: Map<string, Thread[]>): TimelineEntry[] {
  const entries: TimelineEntry[] = []
  for (const raw of nodes) {
    const last = entries[entries.length - 1]
    if (raw.__typename === 'PullRequestCommit') {
      const c = raw.commit
      const commit: Commit = {
        oid: c.oid,
        short: c.abbreviatedOid,
        message: c.messageHeadline,
        date: c.committedDate,
        url: c.url,
        author: {
          login: c.author?.user?.login ?? c.author?.name ?? 'unknown',
          avatarUrl: c.author?.user?.avatarUrl ?? null
        }
      }
      // consecutive commits read as one push, like GitHub groups them
      if (last?.kind === 'commits') last.commits.push(commit)
      else entries.push({ kind: 'commits', id: raw.id, commits: [commit] })
      continue
    }
    if (raw.__typename === 'IssueComment') {
      entries.push({
        kind: 'comment',
        id: raw.id,
        author: actorOf(raw.author),
        body: html(raw.bodyHTML),
        createdAt: raw.createdAt,
        url: raw.url,
        reactions: reactionsOf(raw.reactionGroups)
      })
      continue
    }
    if (raw.__typename === 'PullRequestReview') {
      const threads = threadsByReview.get(raw.id) ?? []
      const body = html(raw.bodyHTML)
      // a reply in an existing thread is stored as an empty COMMENTED review: GitHub hides it, so do we
      if (raw.state === 'COMMENTED' && !body && threads.length === 0) continue
      if (raw.state === 'PENDING') continue
      entries.push({
        kind: 'review',
        id: raw.id,
        author: actorOf(raw.author),
        body,
        state: raw.state,
        createdAt: raw.createdAt ?? '',
        url: raw.url,
        reactions: reactionsOf(raw.reactionGroups),
        threads
      })
      continue
    }
    // a merge also closes the PR; GitHub shows only the merge
    if (raw.__typename === 'ClosedEvent' && last?.kind === 'event' && last.tone === 'merged') continue
    const event = eventOf(raw)
    if (event) entries.push(event)
  }
  return entries
}

export function linkedOf(raw: Raw, kind: LinkedItem['kind']): LinkedItem {
  return {
    kind,
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    state: raw.state,
    isDraft: raw.isDraft ?? false,
    stateReason: raw.stateReason ?? null
  }
}

const METHODS: MergeMethod[] = ['MERGE', 'SQUASH', 'REBASE']

export function mapPullRequest(repository: Raw): PullRequest {
  const pr = repository.pullRequest
  const threadsByReview = new Map<string, Thread[]>()
  // a header page from the first paint has neither, and says so with `partial`
  const threadNodes = (pr.reviewThreads?.nodes ?? []) as Raw[]
  const timelineNodes = (pr.timelineItems?.nodes ?? []) as Raw[]
  for (const raw of threadNodes) {
    const reviewId = raw.comments.nodes[0]?.pullRequestReview?.id
    if (!reviewId) continue
    threadsByReview.set(reviewId, [...(threadsByReview.get(reviewId) ?? []), threadOf(raw)])
  }

  const reviewers = new Map<string, PullRequest['reviewers'][number]>()
  for (const review of pr.latestOpinionatedReviews.nodes as Raw[]) {
    if (review.author) reviewers.set(review.author.login, { name: review.author.login, state: review.state })
  }
  for (const request of pr.reviewRequests.nodes as Raw[]) {
    const name = request.requestedReviewer?.login ?? request.requestedReviewer?.name
    if (name) reviewers.set(name, { name, state: 'REQUESTED' })
  }

  const mergeMethods: MergeMethod[] = []
  if (repository.squashMergeAllowed) mergeMethods.push('SQUASH')
  if (repository.mergeCommitAllowed) mergeMethods.push('MERGE')
  if (repository.rebaseMergeAllowed) mergeMethods.push('REBASE')
  const preferred = METHODS.find((method) => method === repository.viewerDefaultMergeMethod)
  const defaultMergeMethod = preferred && mergeMethods.includes(preferred) ? preferred : (mergeMethods[0] ?? 'MERGE')

  const lastCommit = pr.lastCommit.nodes[0]?.commit
  return {
    id: pr.id,
    repo: repository.nameWithOwner,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    state: pr.state,
    isDraft: pr.isDraft,
    createdAt: pr.createdAt,
    author: actorOf(pr.author),
    body: html(pr.bodyHTML),
    reactions: reactionsOf(pr.reactionGroups),
    baseRefName: pr.baseRefName,
    headRefName: pr.headRefName,
    headOid: lastCommit?.oid ?? null,
    additions: pr.additions,
    deletions: pr.deletions,
    changedFiles: pr.changedFiles,
    commitCount: pr.commits.totalCount,
    mergeable: pr.mergeable,
    mergeStateStatus: pr.mergeStateStatus,
    reviewDecision: pr.reviewDecision ?? null,
    viewerCanUpdate: pr.viewerCanUpdate,
    viewerCanMergeAsAdmin: pr.viewerCanMergeAsAdmin,
    autoMerge: pr.autoMergeRequest
      ? { method: pr.autoMergeRequest.mergeMethod, by: pr.autoMergeRequest.enabledBy?.login ?? null }
      : null,
    mergedAt: pr.mergedAt ?? null,
    mergedBy: pr.mergedBy?.login ?? null,
    labels: pr.labels.nodes,
    assignees: (pr.assignees.nodes as Raw[]).map(actorOf),
    reviewers: [...reviewers.values()],
    checks: ((lastCommit?.statusCheckRollup?.contexts.nodes ?? []) as Raw[]).map(checkOf),
    mergeMethods,
    defaultMergeMethod,
    autoMergeAllowed: repository.autoMergeAllowed,
    closingIssues: ((pr.closingIssuesReferences?.nodes ?? []) as Raw[]).map((raw) => linkedOf(raw, 'issue')),
    timeline: timelineOf(timelineNodes, threadsByReview),
    partial: !pr.timelineItems,
    threads: threadNodes.map(threadOf).sort((a, b) => Number(a.isResolved) - Number(b.isResolved))
  }
}

export async function fetchPullRequest(repo: string, number: number): Promise<PullRequest> {
  const [owner, name] = repo.split('/') as [string, string]
  const data = await graphql<{ repository: Raw }>(PULL_REQUEST_QUERY, { owner, name, number })
  if (!data.repository?.pullRequest) throw new GhError(`Pull request #${number} not found in ${repo}`)
  return mapPullRequest(data.repository)
}

const MAX_FILES = 300

type FileSet = { files: ChangedFile[]; truncated: boolean; patches: Map<string, string | null> }

/**
 * The changed files without their patches, which can weigh megabytes: a panel answer holds 1 MiB,
 * so each patch is sent on its own when its file is opened. The last list is kept per PR.
 */
export function fileStore() {
  const sets = new Map<string, Promise<FileSet>>()

  async function load(repo: string, number: number): Promise<FileSet> {
    const out = await gh(['api', '--paginate', `repos/${repo}/pulls/${number}/files?per_page=100`, '--jq', '.[]'], {
      timeoutMs: 60_000
    })
    const raw = out
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Raw)
    const patches = new Map<string, string | null>()
    const files = raw.slice(0, MAX_FILES).map((file): ChangedFile => {
      patches.set(file.filename, file.patch ?? null)
      return {
        filename: file.filename,
        previousFilename: file.previous_filename ?? null,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        hasPatch: typeof file.patch === 'string'
      }
    })
    return { files, truncated: raw.length > MAX_FILES, patches }
  }

  const key = (repo: string, number: number) => `${repo}#${number}`

  return {
    async list(repo: string, number: number) {
      const pending = load(repo, number)
      sets.set(key(repo, number), pending)
      pending.catch(() => sets.delete(key(repo, number)))
      const { files, truncated } = await pending
      return { files, truncated }
    },
    async patch(repo: string, number: number, filename: string) {
      const set = await (sets.get(key(repo, number)) ??
        this.list(repo, number).then(() => sets.get(key(repo, number))!))
      return { patch: set.patches.get(filename) ?? null }
    }
  }
}
