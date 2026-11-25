// The panel <-> worker contract, declared once: the panels and src/worker.ts both read it.

export type Actor = { login: string; avatarUrl: string | null }

export type Reaction = { content: string; count: number; mine: boolean }

export type ThreadComment = {
  id: string
  author: Actor
  /** GitHub's rendered HTML; the panel sanitizes it and loads its images through the worker. */
  body: string
  createdAt: string
  reactions: Reaction[]
}

export type Thread = {
  id: string
  path: string
  line: number | null
  isResolved: boolean
  isOutdated: boolean
  diffHunk: string
  comments: ThreadComment[]
}

export type Commit = { oid: string; short: string; message: string; date: string; url: string; author: Actor }

export type EventTone = 'muted' | 'open' | 'merged' | 'closed' | 'draft' | 'completed' | 'not-planned'

export type TimelineEntry =
  | { kind: 'comment'; id: string; author: Actor; body: string; createdAt: string; url: string; reactions: Reaction[] }
  | {
      kind: 'review'
      id: string
      author: Actor
      body: string
      state: string
      createdAt: string
      url: string
      reactions: Reaction[]
      threads: Thread[]
    }
  | { kind: 'commits'; id: string; commits: Commit[] }
  | {
      kind: 'event'
      id: string
      tone: EventTone
      actor: string | null
      text: string
      createdAt: string
      label: string | null
      link: { title: string; url: string } | null
    }

export type CheckStatus = 'success' | 'failure' | 'pending' | 'queued' | 'skipped' | 'neutral' | 'cancelled'

export type Check = {
  name: string
  workflow: string | null
  status: CheckStatus
  url: string | null
  description: string | null
}

export type MergeMethod = 'MERGE' | 'SQUASH' | 'REBASE'

export type ReviewerState = 'REQUESTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'COMMENTED' | 'DISMISSED'

/** A pull request or issue named from the other side: the issues a PR closes, the PRs that close an issue. */
export type LinkedItem = {
  kind: 'pr' | 'issue'
  repo: string
  number: number
  title: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  stateReason: string | null
}

/** A pull request or issue an agent's conversation named, with when the panel first saw it. */
export type Mention = LinkedItem & { seenAt: number }

/** A question an agent is waiting on, with the pull requests and issues its wording names. */
export type AgentQuestion = { terminalId: string; askedAt: number; text: string; items: LinkedItem[] }

export type PullRequest = {
  id: string
  repo: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  isDraft: boolean
  createdAt: string
  author: Actor
  body: string
  reactions: Reaction[]
  baseRefName: string
  headRefName: string
  headOid: string | null
  additions: number
  deletions: number
  changedFiles: number
  commitCount: number
  mergeable: string
  mergeStateStatus: string
  reviewDecision: string | null
  viewerCanUpdate: boolean
  viewerCanMergeAsAdmin: boolean
  autoMerge: { method: MergeMethod; by: string | null } | null
  mergedAt: string | null
  mergedBy: string | null
  labels: { name: string; color: string }[]
  assignees: Actor[]
  reviewers: { name: string; state: ReviewerState }[]
  checks: Check[]
  mergeMethods: MergeMethod[]
  defaultMergeMethod: MergeMethod
  autoMergeAllowed: boolean
  /** The issues this PR closes when it merges. */
  closingIssues: LinkedItem[]
  timeline: TimelineEntry[]
  /** Every review thread, unresolved first, for the Threads tab and the blocker count. */
  threads: Thread[]
  /** The header of a first paint: the timeline and threads are still on their way. */
  partial: boolean
}

export type Issue = {
  id: string
  repo: string
  number: number
  title: string
  url: string
  state: 'OPEN' | 'CLOSED'
  /** COMPLETED or NOT_PLANNED once closed. */
  stateReason: string | null
  createdAt: string
  author: Actor
  body: string
  reactions: Reaction[]
  labels: { name: string; color: string }[]
  assignees: Actor[]
  /** The pull requests that close it when they merge. */
  linkedPulls: LinkedItem[]
  timeline: TimelineEntry[]
}

export type IssueAction =
  | { kind: 'comment'; body: string }
  | { kind: 'close'; reason: 'completed' | 'not planned'; body: string }
  | { kind: 'reopen' }
  | { kind: 'react'; subjectId: string; content: string; add: boolean }

/**
 * What `workspace.changed` tells the panel about the focused workspace; the worker finds its folder
 * from it. A bot's workspace has an id and a name only: no branch, and a chat instead of terminals.
 */
export type WorkspaceRef = { id: string | null; branch: string; displayName: string; terminalIds: string[] }

/**
 * The cheap question asked every few seconds: which PR the branch has and a fingerprint of what
 * would change on screen. The worker decides when it actually needs GitHub to answer it.
 */
export type Probe =
  | {
      status: 'found'
      repo: string
      number: number
      fingerprint: string
      nextCheckMs: number
      /** When GitHub was last read for this answer, which may come from the worker's memory. */
      checkedAt: number
      /** The workspace is the repository's main checkout, which Orca never deletes. */
      mainCheckout?: boolean
      /** On a worktree's first probe, the PR's header from the same round trip, to draw before the rest. */
      preview?: PullRequest
    }
  | {
      status: 'none'
      reason: string
      branch: string | null
      repo: string | null
      nextCheckMs: number
      checkedAt: number
    }

/** The workspace's own PR, or one picked from a list. */
export type ProbeTarget = { kind: 'workspace'; workspace: WorkspaceRef } | { kind: 'pr'; repo: string; number: number }

export type ChangedFile = {
  filename: string
  previousFilename: string | null
  status: string
  additions: number
  deletions: number
  hasPatch: boolean
}

export type Action =
  | { kind: 'merge'; method: MergeMethod; headOid: string | null; admin: boolean }
  | { kind: 'enableAutoMerge'; method: MergeMethod }
  | { kind: 'disableAutoMerge' }
  | { kind: 'ready' }
  | { kind: 'draft' }
  | { kind: 'close' }
  | { kind: 'reopen' }
  | { kind: 'updateBranch'; rebase: boolean }
  | { kind: 'comment'; body: string }
  | { kind: 'review'; event: 'approve' | 'request-changes' | 'comment'; body: string }
  | { kind: 'reply'; threadId: string; body: string }
  | { kind: 'resolve'; threadId: string; resolved: boolean }
  | { kind: 'react'; subjectId: string; content: string; add: boolean }

export type FixTarget =
  { kind: 'conflicts' } | { kind: 'checks' } | { kind: 'threads' } | { kind: 'thread'; threadId: string }

export type InboxItem = {
  kind: 'pr' | 'issue'
  repo: string
  number: number
  title: string
  url: string
  author: string
  updatedAt: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  /** An issue closed as COMPLETED or NOT_PLANNED. */
  stateReason: string | null
  comments: number
  isDraft: boolean
  headRefName: string | null
  /** The PR's head lives in the same repository, so a worktree can check its branch out. */
  sameRepo: boolean
  checks: 'success' | 'failure' | 'pending' | 'none'
  reviewDecision: string | null
  /** The repository is an Orca project on this machine, so the PR can open in a workspace. */
  inOrca: boolean
}

export type InboxSection = { total: number; items: InboxItem[]; viewAllUrl: string }

export type Inbox = { login: string; review: InboxSection; mine: InboxSection; issues: InboxSection }

export type PullState = 'open' | 'closed'

export type ListKind = 'pr' | 'issue'

export type RepoPulls = { open: number; closed: number; items: InboxItem[]; viewAllUrl: string }

type PrRef = { repo: string; number: number }

declare module 'orca' {
  interface PluginRequests {
    /** `maxAgeMs` tightens the usual pace once: what the user comes back to should not be a minute old. */
    'pr.probe': { input: { target: ProbeTarget; force: boolean; maxAgeMs: number | null }; output: Probe }
    /** A repository's pull requests or issues, like its Pull requests and Issues pages on GitHub. */
    'repo.list': { input: { repo: string; state: PullState; kind: ListKind }; output: RepoPulls }
    'issue.get': { input: PrRef; output: Issue }
    'issue.action': { input: PrRef & { action: IssueAction }; output: { message: string } }
    'pr.get': { input: PrRef; output: PullRequest }
    /** Loads, in the background, the PR of every worktree on a branch, so switching to one is instant. */
    'pr.prefetch': { input: Record<string, never>; output: { started: boolean } }
    'pr.files': { input: PrRef; output: { files: ChangedFile[]; truncated: boolean } }
    'pr.patch': { input: PrRef & { filename: string }; output: { patch: string | null } }
    'pr.action': { input: PrRef & { action: Action }; output: { message: string } }
    /** Drafts the message "Fix with agent" sends, with the failing logs or the review comments it needs. */
    'pr.fixPrompt': { input: PrRef & { target: FixTarget }; output: { text: string } }
    /** One image of a description or comment, as a data URL: the panel itself has no network. */
    'pr.image': { input: { url: string }; output: { dataUrl: string } }
    /** Opens a file of the workspace's worktree in Orca's editor, at a line when given. */
    'file.open': { input: { workspace: WorkspaceRef; path: string; line: number | null }; output: { opened: boolean } }
    /** Reads what the worktree's terminals show and returns the PRs and issues named there so far. */
    'mentions.scan': { input: { workspace: WorkspaceRef }; output: { mentions: Mention[] } }
    /** The questions the worktree's agents are waiting on that name a pull request or an issue. */
    'questions.get': { input: { workspace: WorkspaceRef }; output: { questions: AgentQuestion[] } }
    /** Removes the workspace's worktree from Orca once its PR is merged; never the repository's main checkout. */
    'workspace.remove': { input: { workspace: WorkspaceRef }; output: null }
    /** The agent working on a PR: a terminal of the worktree on its branch, the one asking about it first. */
    'pr.agent': { input: PrRef & { headRefName: string }; output: { terminalId: string | null; asking: boolean } }
    /** Shows that agent's workspace and terminal tab in Orca. */
    'agent.open': { input: { terminalId: string }; output: { opened: boolean } }
    'agent.send': { input: { terminalId: string; text: string }; output: { accepted: boolean } }
    'inbox.get': { input: { force: boolean }; output: Inbox }
    /** Reveals the worktree already on the PR's branch, or creates one that checks it out. */
    'inbox.open': { input: { repo: string; number: number }; output: { message: string } }
  }
  interface PluginPanelEvents {
    /** An agent asked a question, or one was answered: the panel reads its worktree's again. */
    'questions.changed': Record<string, never>
  }
}
