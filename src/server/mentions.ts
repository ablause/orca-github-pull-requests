// The pull requests and issues an agent's conversation names, read from what its terminal shows when
// a turn ends: the rendered screen, so a number typed key by key never reads as #1, #10, #107.
// A chat has no screen: its conversation is read instead, as a bot's is.
import type { LinkedItem, Mention } from '../protocol.ts'
import { git, run } from './exec.ts'
import { graphql } from './gh.ts'
import { slugOf } from './inbox.ts'
import { terminals } from './workspace.ts'

export type Ref = { repo: string; number: number }

const NAME = '[A-Za-z0-9_.-]+'
const URL_REF = new RegExp(`github\\.com/(${NAME}/${NAME})/(?:pull|issues)/(\\d+)`, 'g')
const REPO_REF = new RegExp(`(?<![\\w/.-])(${NAME}/${NAME})#(\\d+)\\b`, 'g')
/**
 * A bare #1072 belongs to the worktree's own repository. One digit is left out: "step #1" is
 * prose far more often than a reference, and `&#39;` or `abc#12` are not references either.
 */
const BARE_REF = /(?<![\w&/#])#(\d{2,7})\b(?![-\w])/g
/** A question is a few purposeful words: there "merge #7?" names a pull request, so one digit counts. */
const BARE_REF_SHORT = /(?<![\w&/#])#(\d{1,7})\b(?![-\w])/g

const keyOf = (ref: Ref) => `${ref.repo.toLowerCase()}#${ref.number}`

/** Every reference in reading order, URLs and owner/repo#N first claimed so their #N is not read twice. */
export function extractMentions(text: string, repo: string | null, oneDigit = false): Ref[] {
  const found: { at: number; ref: Ref }[] = []
  const taken: [number, number][] = []
  const claim = (match: RegExpMatchArray, ref: Ref) => {
    const at = match.index ?? 0
    taken.push([at, at + match[0].length])
    found.push({ at, ref })
  }
  for (const match of text.matchAll(URL_REF)) claim(match, { repo: match[1]!, number: Number(match[2]) })
  for (const match of text.matchAll(REPO_REF)) {
    const at = match.index ?? 0
    if (!taken.some(([start, end]) => at >= start && at < end))
      claim(match, { repo: match[1]!, number: Number(match[2]) })
  }
  if (repo) {
    for (const match of text.matchAll(oneDigit ? BARE_REF_SHORT : BARE_REF)) {
      const at = match.index ?? 0
      if (!taken.some(([start, end]) => at >= start && at < end)) {
        found.push({ at, ref: { repo, number: Number(match[1]) } })
      }
    }
  }
  const seen = new Set<string>()
  return found
    .sort((a, b) => a.at - b.at)
    .map((entry) => entry.ref)
    .filter((ref) => ref.number > 0 && !seen.has(keyOf(ref)) && seen.add(keyOf(ref)))
}

const ITEM_FIELDS = `__typename
  ... on Issue { number title state stateReason repository { nameWithOwner } }
  ... on PullRequest { number title state isDraft repository { nameWithOwner } }`

// GraphQL payloads are mapped field by field below
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Raw = any

function itemOf(raw: Raw): LinkedItem | null {
  if (!raw?.repository) return null
  return {
    kind: raw.__typename === 'PullRequest' ? 'pr' : 'issue',
    repo: raw.repository.nameWithOwner,
    number: raw.number,
    title: raw.title,
    state: raw.state,
    isDraft: raw.isDraft ?? false,
    stateReason: raw.stateReason ?? null
  }
}

/** One query for every new reference; a number that does not exist fails it, so each is then asked alone. */
async function resolveAll(refs: Ref[]): Promise<(LinkedItem | null)[]> {
  const ask = (batch: Ref[]) => {
    const variables: Record<string, string | number> = {}
    const declarations: string[] = []
    const fields = batch.map((ref, i) => {
      const [owner, name] = ref.repo.split('/') as [string, string]
      Object.assign(variables, { [`o${i}`]: owner, [`r${i}`]: name, [`n${i}`]: ref.number })
      declarations.push(`$o${i}: String!, $r${i}: String!, $n${i}: Int!`)
      return `m${i}: repository(owner: $o${i}, name: $r${i}) { issueOrPullRequest(number: $n${i}) { ${ITEM_FIELDS} } }`
    })
    return graphql<Record<string, Raw>>(`query (${declarations.join(', ')}) { ${fields.join('\n')} }`, variables).then(
      (data) => batch.map((_, i) => itemOf(data[`m${i}`]?.issueOrPullRequest))
    )
  }
  try {
    return await ask(refs)
  } catch {
    return Promise.all(
      refs.map((ref) =>
        ask([ref]).then(
          (items) => items[0] ?? null,
          () => null
        )
      )
    )
  }
}

/** A reference that resolved to nothing is asked again after this long: it may be opened since. */
const MISSING_MS = 10 * 60_000

/** What GitHub says each reference is, asked once and shared by what agents name and what they ask. */
export function referenceBook() {
  const items = new Map<string, { item: LinkedItem | null; at: number }>()
  const repos = new Map<string, string | null>()

  async function repoOf(dir: string): Promise<string | null> {
    if (!repos.has(dir)) {
      const remote = await git(dir, 'remote', 'get-url', 'origin')
      const slug = remote ? slugOf(remote) : null
      repos.set(dir, slug)
    }
    return repos.get(dir) ?? null
  }

  /** Asks GitHub only for the references not seen before. */
  async function learn(refs: Ref[]): Promise<void> {
    const now = Date.now()
    const unknown = refs.filter((ref) => {
      const known = items.get(keyOf(ref))
      return !known || (!known.item && now - known.at > MISSING_MS)
    })
    if (unknown.length === 0) return
    const resolved = await resolveAll(unknown)
    unknown.forEach((ref, i) => items.set(keyOf(ref), { item: resolved[i] ?? null, at: now }))
  }

  const itemAt = (key: string): LinkedItem | null => items.get(key)?.item ?? null

  /** The references that exist on GitHub, in the order given. */
  async function resolve(refs: Ref[]): Promise<LinkedItem[]> {
    await learn(refs)
    return refs.flatMap((ref) => itemAt(keyOf(ref)) ?? [])
  }

  return { repoOf, learn, itemAt, resolve }
}

export type ReferenceBook = ReturnType<typeof referenceBook>

const KEEP = 40

/** Where a workspace's agents talk: the terminals of its folder, and its chats by session. */
export type Place = { key: string; dir: string | null; chats: string[] }

type ChatEntry = { kind?: string; text?: string }

/** What a chat said, oldest first: its messages and questions, never the tools' own output. */
export function conversationText(entries: ChatEntry[]): string {
  return entries
    .flatMap((entry) => ((entry.kind === 'message' || entry.kind === 'question') && entry.text ? [entry.text] : []))
    .join('\n')
}

/** `orca agent read` gives at most this many of a chat's newest entries. */
const CHAT_ENTRIES = 100

export function mentionStore(book: ReferenceBook) {
  /** Per workspace, each reference with when it first showed: the newest lead. */
  const byWorktree = new Map<string, Map<string, number>>()

  async function screenOf(handle: string): Promise<string> {
    const out = JSON.parse(
      await run('orca', ['terminal', 'read', '--terminal', handle, '--screen', '--json'], { timeoutMs: 10_000 })
    ) as { result?: { terminal?: { tail?: string[] } } }
    return (out.result?.terminal?.tail ?? []).join('\n')
  }

  async function chatOf(session: string): Promise<string> {
    const out = JSON.parse(
      await run('orca', ['agent', 'read', session, '--limit', String(CHAT_ENTRIES), '--json'], { timeoutMs: 10_000 })
    ) as { result?: { entries?: ChatEntry[] } }
    return conversationText(out.result?.entries ?? [])
  }

  /** Reads what the workspace's terminals show and its chats say now, and returns what they named so far. */
  async function scan({ key, dir, chats }: Place): Promise<Mention[]> {
    // a folder outside Git, a bot's home, has no repository: only URLs and owner/repo#N name something there
    const repo = dir ? await book.repoOf(dir) : null
    const rows = dir ? (await terminals(true)).filter((row) => row.worktreePath === dir && row.handle) : []
    const texts = await Promise.all([
      ...rows.map((row) => screenOf(row.handle!).catch(() => '')),
      ...chats.map((session) => chatOf(session).catch(() => ''))
    ])
    const refs = texts.flatMap((text) => extractMentions(text, repo))
    await book.learn(refs)

    const now = Date.now()
    const seen = byWorktree.get(key) ?? new Map<string, number>()
    // later on screen reads as more recent, so the order holds within one scan
    refs.forEach((ref, i) => {
      if (!seen.has(keyOf(ref))) seen.set(keyOf(ref), now + i)
    })
    const kept = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, KEEP)
    byWorktree.set(key, new Map(kept))
    return kept.flatMap(([key, seenAt]) => {
      const item = book.itemAt(key)
      return item ? [{ ...item, seenAt }] : []
    })
  }

  return { scan }
}
