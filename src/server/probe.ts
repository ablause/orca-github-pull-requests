import type { Probe, PullRequest } from '../protocol.ts'
import { git } from './exec.ts'
import { gh, GhError, graphql } from './gh.ts'
import { mapPullRequest } from './pull-request.ts'
import { BRANCH_QUERY } from './query.ts'

const PROBE_QUERY = `
query ($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      updatedAt state isDraft headRefOid mergeable mergeStateStatus reviewDecision
      commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
    }
  }
}`

type Light = {
  updatedAt: string
  state: 'OPEN' | 'CLOSED' | 'MERGED'
  headRefOid: string
  mergeable: string
  mergeStateStatus: string
  rollup: string | null
  fingerprint: string
}

/** How often the panel asks; GitHub is asked only when the last answer has gone stale. */
const PANEL_TICK_MS = 5_000
const NO_PR_MS = 60_000
const IDLE_MS = 60_000
const CHECKS_RUNNING_MS = 15_000
/** GitHub computes mergeability asynchronously, usually within seconds of a push. */
const MERGEABILITY_PENDING_MS = 2_500
const CLOSED_MS = 15 * 60_000

/** How long the last answer stays good, by the state it described. */
function intervalFor(light: Light | null): number {
  if (!light) return NO_PR_MS
  const checksRunning = light.rollup === 'PENDING' || light.rollup === 'EXPECTED'
  if (light.state === 'MERGED') return checksRunning ? IDLE_MS : Number.POSITIVE_INFINITY
  if (light.state === 'CLOSED') return CLOSED_MS
  if (light.mergeable === 'UNKNOWN' && !['CLEAN', 'BEHIND', 'BLOCKED'].includes(light.mergeStateStatus)) {
    return MERGEABILITY_PENDING_MS
  }
  return checksRunning ? CHECKS_RUNNING_MS : IDLE_MS
}

type Located = { repo: string; number: number } | { repo: null; reason: string; branch: string | null }

async function view(dir: string, selector: string[]): Promise<Located> {
  const out = JSON.parse(await gh(['pr', 'view', ...selector, '--json', 'number,url'], { cwd: dir })) as {
    number: number
    url: string
  }
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(out.url)
  if (!match?.[1]) return { repo: null, reason: `Unexpected pull request URL: ${out.url}`, branch: null }
  return { repo: match[1], number: out.number }
}

function failure(error: unknown): Located & { repo: null } {
  const message = error instanceof Error ? error.message : String(error)
  const found = /no pull requests found for branch "([^"]+)"/i.exec(message)
  if (found) return { repo: null, reason: 'No pull request for this branch.', branch: found[1] ?? null }
  if (/not a git repository/i.test(message))
    return { repo: null, reason: 'This workspace is not a git repository.', branch: null }
  if (/no git remotes|none of the git remotes/i.test(message)) {
    return { repo: null, reason: 'This repository has no GitHub remote.', branch: null }
  }
  return { repo: null, reason: message, branch: null }
}

/** The PR `gh` associates with the checked-out branch, which follows forks and push remotes. */
async function locate(dir: string): Promise<Located> {
  try {
    return await view(dir, [])
  } catch (error) {
    if (error instanceof GhError && /rate limit/i.test(error.message)) throw error
    const located = failure(error)
    // a PR checked out under another local name still tracks the real head through its upstream
    const merge = located.branch ? await git(dir, 'config', '--get', `branch.${located.branch}.merge`) : null
    const upstream = merge?.replace(/^refs\/heads\//, '') || null
    if (!upstream || upstream === located.branch) return located
    try {
      return await view(dir, [upstream])
    } catch {
      return located
    }
  }
}

// GraphQL payloads are read field by field below
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any

/** The fingerprint of what the panel shows, built the same way from the light probe and from a header page. */
function lightFrom(raw: Raw): Light {
  const fields = {
    updatedAt: raw.updatedAt,
    state: raw.state,
    isDraft: raw.isDraft,
    headRefOid: raw.headRefOid,
    mergeable: raw.mergeable,
    mergeStateStatus: raw.mergeStateStatus,
    reviewDecision: raw.reviewDecision
  }
  const rollup = (raw.commits ?? raw.lastCommit)?.nodes?.[0]?.commit.statusCheckRollup?.state ?? null
  return { ...fields, rollup, fingerprint: JSON.stringify({ ...fields, rollup }) }
}

async function readLight(repo: string, number: number): Promise<Light> {
  const [owner, name] = repo.split('/') as [string, string]
  const data = await graphql<{ repository: { pullRequest: Raw } }>(PROBE_QUERY, { owner, name, number })
  return lightFrom(data.repository.pullRequest)
}

type Found = { located: Located; repo: string; light: Light | null; preview: PullRequest | null }

/**
 * The branch's PR and its header in one round trip, instead of `gh pr view` then two queries. A
 * repository with an `upstream` remote works from a fork, where `gh pr view` knows better: null.
 */
async function findByBranch(dir: string, branch: string): Promise<Found | null> {
  const [origin, upstreamRemote, merge] = await Promise.all([
    git(dir, 'remote', 'get-url', 'origin'),
    git(dir, 'remote', 'get-url', 'upstream'),
    git(dir, 'config', '--get', `branch.${branch}.merge`)
  ])
  const slug = origin ? /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?$/i.exec(origin.trim())?.[1] : undefined
  if (!slug || upstreamRemote) return null
  const head = merge?.replace(/^refs\/heads\//, '') || branch
  const [owner, name] = slug.split('/') as [string, string]
  const data = await graphql<{ repository: Raw }>(BRANCH_QUERY, { owner, name, head })
  const repository = data.repository
  const repo: string = repository.nameWithOwner
  const sameRepo = (node: Raw) => node.headRepository?.nameWithOwner?.toLowerCase() === repo.toLowerCase()
  const open = (repository.open.nodes as Raw[]).find(sameRepo)
  if (open) {
    return {
      located: { repo, number: open.number },
      repo,
      light: lightFrom(open),
      preview: mapPullRequest({ ...repository, pullRequest: open })
    }
  }
  const latest = (repository.latest.nodes as Raw[]).find(sameRepo)
  if (latest) return { located: { repo, number: latest.number }, repo, light: null, preview: null }
  return {
    located: { repo: null, reason: 'No pull request for this branch.', branch },
    repo,
    light: null,
    preview: null
  }
}

type Entry = {
  branch: string | null
  /** The remote-tracking ref moves on push, which is when GitHub's view of the PR changes. */
  pushedOid: string | null
  located: Located
  light: Light | null
  checkedAt: number
}

/** The GitHub repository a folder belongs to, even on a branch with no PR, so its list can show. */
function repoFinder() {
  const repos = new Map<string, Promise<string | null>>()
  const find = (dir: string): Promise<string | null> => {
    let repo = repos.get(dir)
    if (!repo) {
      repo = gh(['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'], { cwd: dir }).then(
        (out) => out.trim() || null,
        () => null
      )
      repos.set(dir, repo)
    }
    return repo
  }
  /** A repository the branch lookup already named, so a branch without a PR asks GitHub nothing more. */
  const seed = (dir: string, repo: string) => void repos.set(dir, Promise.resolve(repo))
  return Object.assign(find, { seed })
}

const nextCheck = (light: Light | null, checkedAt: number, now: number) =>
  Math.max(MERGEABILITY_PENDING_MS, Math.min(PANEL_TICK_MS, intervalFor(light) - (now - checkedAt)))

export function prober() {
  const entries = new Map<string, Entry>()
  const picked = new Map<string, { light: Light; checkedAt: number }>()
  /** The last state GitHub gave for each PR, whichever probe read it: the full page is reused while it holds. */
  const fingerprints = new Map<string, string>()
  const repoOf = repoFinder()

  async function remember(repo: string, number: number): Promise<Light> {
    const value = await readLight(repo, number)
    fingerprints.set(`${repo}#${number}`, value.fingerprint)
    return value
  }

  /** The PR of the branch checked out in `dir`. */
  async function workspace(dir: string, force: boolean, maxAgeMs = Number.POSITIVE_INFINITY): Promise<Probe> {
    const [branch, pushedOid] = await Promise.all([git(dir, 'branch', '--show-current'), git(dir, 'rev-parse', '@{u}')])
    const previous = entries.get(dir)
    const now = Date.now()
    const moved = !previous || previous.branch !== branch
    const pushed = previous !== undefined && previous.pushedOid !== pushedOid
    const due = !previous || now - previous.checkedAt >= Math.min(intervalFor(previous.light), maxAgeMs)

    let entry: Entry
    let preview: PullRequest | null = null
    if (previous && !force && !moved && !pushed && !due) {
      entry = previous
    } else {
      try {
        // the branch's PR is looked up again only when the branch changed or none was found yet
        const known = !moved && previous?.located.repo ? previous.located : null
        const found = known || !branch ? null : await findByBranch(dir, branch).catch(() => null)
        const located = known ?? found?.located ?? (await locate(dir))
        let light = found?.light ?? null
        if (light && located.repo) fingerprints.set(`${located.repo}#${located.number}`, light.fingerprint)
        else light = located.repo ? await remember(located.repo, located.number) : null
        preview = found?.preview ?? null
        if (found && located.repo === null) repoOf.seed(dir, found.repo)
        entry = { branch, pushedOid, located, light, checkedAt: now }
        entries.set(dir, entry)
      } catch (error) {
        // a failed check waits out the same interval instead of retrying on every tick
        if (previous) entries.set(dir, { ...previous, branch, pushedOid, checkedAt: now })
        throw error
      }
    }

    const nextCheckMs = nextCheck(entry.light, entry.checkedAt, now)
    const { located, light, checkedAt } = entry
    if (located.repo === null) {
      const repo = await repoOf(dir)
      return { status: 'none', reason: located.reason, branch: located.branch ?? branch, repo, nextCheckMs, checkedAt }
    }
    if (!light) {
      return { status: 'none', reason: 'Pull request not found.', branch, repo: located.repo, nextCheckMs, checkedAt }
    }
    return {
      status: 'found',
      repo: located.repo,
      number: located.number,
      fingerprint: light.fingerprint,
      nextCheckMs,
      checkedAt,
      ...(preview ? { preview } : {})
    }
  }

  /** A PR picked from a list, polled at the same pace as the workspace's own. */
  async function pullRequest(
    repo: string,
    number: number,
    force: boolean,
    maxAgeMs = Number.POSITIVE_INFINITY
  ): Promise<Probe> {
    const key = `${repo}#${number}`
    const previous = picked.get(key)
    const now = Date.now()
    let entry = previous
    if (!entry || force || now - entry.checkedAt >= Math.min(intervalFor(entry.light), maxAgeMs)) {
      entry = { light: await remember(repo, number), checkedAt: now }
      picked.set(key, entry)
    }
    return {
      status: 'found',
      repo,
      number,
      fingerprint: entry.light.fingerprint,
      nextCheckMs: nextCheck(entry.light, entry.checkedAt, now),
      checkedAt: entry.checkedAt
    }
  }

  return {
    workspace,
    pullRequest,
    fingerprintOf: (repo: string, number: number) => fingerprints.get(`${repo}#${number}`) ?? null
  }
}
