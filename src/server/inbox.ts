import type { Inbox, InboxItem, InboxSection, ListKind, PullState, RepoPulls } from '../protocol.ts'
import { git, run } from './exec.ts'
import { graphql } from './gh.ts'
import { terminals, worktrees, type WorktreeRow } from './workspace.ts'

const PR_FIELDS = `number title url state isDraft updatedAt repository { nameWithOwner } author { login } headRefName
  headRepository { nameWithOwner } comments { totalCount } reviewDecision
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }`
const ISSUE_FIELDS = `number title url state stateReason updatedAt repository { nameWithOwner } author { login } comments { totalCount }`

const SEARCHES = {
  review: 'is:open is:pr review-requested:@me archived:false sort:updated-desc',
  mine: 'is:open is:pr author:@me archived:false sort:updated-desc',
  issues: 'is:open is:issue involves:@me archived:false sort:updated-desc'
} as const
const PER_SECTION = 20

const INBOX_QUERY = `query {
  viewer { login }
  review: search(query: "${SEARCHES.review}", type: ISSUE, first: ${PER_SECTION}) { issueCount nodes { ... on PullRequest { ${PR_FIELDS} } } }
  mine: search(query: "${SEARCHES.mine}", type: ISSUE, first: ${PER_SECTION}) { issueCount nodes { ... on PullRequest { ${PR_FIELDS} } } }
  issues: search(query: "${SEARCHES.issues}", type: ISSUE, first: ${PER_SECTION}) { issueCount nodes { ... on Issue { ${ISSUE_FIELDS} } } }
}`

type RawItem = {
  number: number
  title: string
  url: string
  state: string
  stateReason?: string | null
  isDraft?: boolean
  updatedAt: string
  repository: { nameWithOwner: string }
  author: { login: string } | null
  headRefName?: string
  headRepository?: { nameWithOwner: string } | null
  comments: { totalCount: number }
  reviewDecision?: string | null
  commits?: { nodes: { commit: { statusCheckRollup: { state: string } | null } }[] }
}
type RawSearch = { issueCount: number; nodes: RawItem[] }

function checksOf(raw: RawItem): InboxItem['checks'] {
  const state = raw.commits?.nodes[0]?.commit.statusCheckRollup?.state
  if (!state) return 'none'
  if (state === 'SUCCESS') return 'success'
  if (state === 'PENDING' || state === 'EXPECTED') return 'pending'
  return 'failure'
}

function itemOf(raw: RawItem, kind: InboxItem['kind'], byRepo: Map<string, unknown>): InboxItem {
  return {
    kind,
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    url: raw.url,
    author: raw.author?.login ?? 'ghost',
    updatedAt: raw.updatedAt,
    state: raw.state === 'MERGED' ? 'MERGED' : raw.state === 'OPEN' ? 'OPEN' : 'CLOSED',
    stateReason: raw.stateReason ?? null,
    comments: raw.comments.totalCount,
    isDraft: raw.isDraft ?? false,
    headRefName: raw.headRefName ?? null,
    sameRepo: raw.headRepository?.nameWithOwner === raw.repository.nameWithOwner,
    checks: kind === 'pr' ? checksOf(raw) : 'none',
    reviewDecision: raw.reviewDecision ?? null,
    inOrca: byRepo.has(raw.repository.nameWithOwner.toLowerCase())
  }
}

const PULLS_PER_PAGE = 30

/** One round trip for the list and both counts, as GitHub's Open and Closed tabs show them. */
const LIST_QUERY = `query ($listed: String!, $open: String!, $closed: String!) {
  items: search(query: $listed, type: ISSUE, first: ${PULLS_PER_PAGE}) { nodes {
    ... on PullRequest { ${PR_FIELDS} }
    ... on Issue { ${ISSUE_FIELDS} }
  } }
  open: search(query: $open, type: ISSUE, first: 0) { issueCount }
  closed: search(query: $closed, type: ISSUE, first: 0) { issueCount }
}`

export const slugOf = (remote: string) =>
  /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(remote.trim())?.[1]?.toLowerCase() ?? null

type Repo = { id: string; path: string; kind: string }

/** Orca repos by the GitHub repository their origin points at; remotes rarely change, so this is cached. */
function repoIndex() {
  let cached: { at: number; byRepo: Map<string, Repo> } | null = null
  return async function byRepo(): Promise<Map<string, Repo>> {
    if (cached && Date.now() - cached.at < 5 * 60_000) return cached.byRepo
    const out = JSON.parse(await run('orca', ['repo', 'list', '--json'], { timeoutMs: 15_000 })) as {
      result?: { repos: Repo[] }
    }
    const map = new Map<string, Repo>()
    await Promise.all(
      (out.result?.repos ?? [])
        .filter((repo) => repo.kind === 'git')
        .map(async (repo) => {
          const remote = await git(repo.path, 'remote', 'get-url', 'origin')
          const slug = remote ? slugOf(remote) : null
          if (slug && !map.has(slug)) map.set(slug, repo)
        })
    )
    cached = { at: Date.now(), byRepo: map }
    return map
  }
}

async function orca(args: string[]): Promise<void> {
  await run('orca', [...args, '--json'], { timeoutMs: 120_000 })
}

export function inbox() {
  const repos = repoIndex()

  /** GitHub search takes seconds: the last answer is served at once and refreshed behind it. */
  const FRESH_MS = 30_000
  let last: { at: number; inbox: Inbox } | null = null
  let inflight: Promise<Inbox> | null = null
  const refresh = () => {
    inflight ??= fetchInbox()
      .then((inbox) => {
        last = { at: Date.now(), inbox }
        return inbox
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  async function read(force: boolean): Promise<Inbox> {
    if (!last || force) return refresh()
    if (Date.now() - last.at > FRESH_MS) void refresh().catch(() => undefined)
    return last.inbox
  }

  async function fetchInbox(): Promise<Inbox> {
    const [data, byRepo] = await Promise.all([
      graphql<{ viewer: { login: string }; review: RawSearch; mine: RawSearch; issues: RawSearch }>(INBOX_QUERY, {}),
      repos().catch(() => new Map<string, Repo>())
    ])
    const section = (search: RawSearch, kind: InboxItem['kind'], query: string): InboxSection => ({
      total: search.issueCount,
      viewAllUrl: `https://github.com/${kind === 'pr' ? 'pulls' : 'issues'}?q=${encodeURIComponent(query.replace(/ sort:\S+/, ''))}`,
      items: search.nodes.filter((raw) => raw?.repository).map((raw) => itemOf(raw, kind, byRepo))
    })
    return {
      login: data.viewer.login,
      review: section(data.review, 'pr', SEARCHES.review),
      mine: section(data.mine, 'pr', SEARCHES.mine),
      issues: section(data.issues, 'issue', SEARCHES.issues)
    }
  }

  async function list(repo: string, state: PullState, kind: ListKind): Promise<RepoPulls> {
    const base = `repo:${repo} is:${kind}`
    const listed = `${base} is:${state} sort:updated-desc`
    const [data, byRepo] = await Promise.all([
      graphql<{ items: { nodes: RawItem[] }; open: { issueCount: number }; closed: { issueCount: number } }>(
        LIST_QUERY,
        { listed, open: `${base} is:open`, closed: `${base} is:closed` }
      ),
      repos().catch(() => new Map<string, Repo>())
    ])
    return {
      open: data.open.issueCount,
      closed: data.closed.issueCount,
      items: data.items.nodes.filter((raw) => raw?.repository).map((raw) => itemOf(raw, kind, byRepo)),
      viewAllUrl: `https://github.com/${repo}/${kind === 'pr' ? 'pulls' : 'issues'}?q=${encodeURIComponent(listed.replace(/ sort:\S+/, '').replace(`repo:${repo} `, ''))}`
    }
  }

  /** The worktree on a PR's head branch, among those of a repository Orca knows. */
  async function worktreeOn(repo: Repo, headRefName: string): Promise<WorktreeRow | null> {
    for (const tree of (await worktrees()).filter((t) => t.repoId === repo.id)) {
      const branch = tree.branch.replace(/^refs\/heads\//, '')
      // a local name that differs still tracks the PR's head through its upstream
      const tracked = branch
        ? (await git(tree.path, 'config', '--get', `branch.${branch}.merge`))?.replace(/^refs\/heads\//, '')
        : null
      if (branch === headRefName || tracked === headRefName) return tree
    }
    return null
  }

  /** The folder of the worktree on a PR's branch, when Orca has one. */
  async function worktreeOf(repoSlug: string, headRefName: string): Promise<string | null> {
    const repo = (await repos()).get(repoSlug.toLowerCase())
    return repo ? ((await worktreeOn(repo, headRefName))?.path ?? null) : null
  }

  /** The branch to check out, as GitHub names it: the panel's word is not enough to run git with. */
  async function headOf(repoSlug: string, number: number): Promise<string> {
    const [owner, name] = repoSlug.split('/') as [string, string]
    const data = await graphql<{
      repository: { pullRequest: { headRefName: string; isCrossRepository: boolean } | null } | null
    }>(
      'query ($o: String!, $r: String!, $n: Int!) { repository(owner: $o, name: $r) { pullRequest(number: $n) { headRefName isCrossRepository } } }',
      { o: owner, r: name, n: number }
    )
    const pr = data.repository?.pullRequest
    if (!pr) throw new Error(`#${number} is not a pull request of ${repoSlug}.`)
    // a fork's branch is not on origin: a branch of the same name there would be other code
    if (pr.isCrossRepository) {
      throw new Error(`#${number} comes from a fork. Check it out with gh pr checkout ${number} -R ${repoSlug}.`)
    }
    if (pr.headRefName.startsWith('-')) throw new Error(`#${number} has a branch name git would read as an option.`)
    return pr.headRefName
  }

  /** The worktree already on the PR's branch, else a new worktree that checks the head branch out. */
  async function open(repoSlug: string, number: number): Promise<{ message: string }> {
    const repo = (await repos()).get(repoSlug.toLowerCase())
    if (!repo) throw new Error(`${repoSlug} is not a repository in Orca on this machine.`)

    // a fork's branch can share a name with a local one, so even finding a worktree waits for GitHub
    const head = await headOf(repoSlug, number)
    const tree = await worktreeOn(repo, head)
    if (tree) {
      // Orca reveals a worktree by focusing one of its terminals; a new one is opened when it has none
      const terminal = (await terminals().catch(() => [])).find((row) => row.worktreePath === tree.path && row.handle)
      if (terminal?.handle) await orca(['terminal', 'switch', '--terminal', terminal.handle])
      else await orca(['terminal', 'create', '--worktree', `path:${tree.path}`, '--title', `PR #${number}`, '--focus'])
      return { message: `Opened ${tree.displayName}` }
    }

    // forced like origin's own refspec: a rebased pull request moves its branch backwards
    await run('git', ['-C', repo.path, 'fetch', 'origin', `+refs/heads/${head}:refs/remotes/origin/${head}`], {
      timeoutMs: 60_000
    })
    await orca([
      'worktree',
      'create',
      '--repo',
      `path:${repo.path}`,
      '--name',
      `review-${number}`,
      '--branch',
      head,
      '--base-branch',
      `origin/${head}`,
      '--pr',
      String(number),
      '--activate'
    ])
    return { message: `Checked out #${number} in a new worktree` }
  }

  return { read, open, list, worktreeOf }
}
