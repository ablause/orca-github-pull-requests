// The panel's state and everything that changes it. Views read it through useAppState and call
// these functions; nothing else writes it.
import type {
  Action,
  AgentQuestion,
  ChangedFile,
  FixTarget,
  Inbox,
  Issue,
  IssueAction,
  ListKind,
  Mention,
  Probe,
  PullRequest,
  PullState,
  RepoPulls,
  WorkspaceRef
} from '../protocol'
import { errorText, type Tone } from '../ui/format'
import { useEffect, useReducer } from '../vendor/preact.mjs'

/** Where the panel stands: the workspace's own PR, its repository's list, or a PR or issue picked from it. */
export type View =
  | { kind: 'workspace' }
  | { kind: 'list' }
  | { kind: 'pr'; repo: string; number: number }
  | { kind: 'issue'; repo: string; number: number }

export type Agent = { terminalId: string; label: string }

export type FixDraft = {
  /** Which "Fix with agent" button opened it: one drawer at a time. */
  key: string
  target: FixTarget
  text: string
  loading: boolean
  agents: Agent[] | null
  terminalId: string | null
  error: string | null
}

export type State = {
  view: View
  workspace: WorkspaceRef | null
  /** What the workspace's branch has: its PR, or none and the repository it belongs to. */
  probe: Probe | null
  probeError: string | null
  pr: PullRequest | null
  /** The issue on screen, when the view is one. */
  issue: Issue | null
  /** When GitHub last confirmed what the panel shows, for the "Updated" cue beside Refresh. */
  checkedAt: number | null
  loadError: string | null
  tab: string
  busy: string | null
  /** Orca focuses another workspace before a removal answers, so it is tied to its workspace, not the panel. */
  removing: WorkspaceRef[]
  notice: { tone: Tone; text: string } | null
  files: { list: ChangedFile[]; truncated: boolean } | { error: string } | null
  patches: Record<string, string | null | 'loading'>
  fix: FixDraft | null
  listState: PullState
  /** Whether the repository list shows pull requests or issues. */
  listKind: ListKind
  pulls: { key: string; data: RepoPulls } | null
  inbox: Inbox | null
  listError: string | null
  listLoading: boolean
  /** A full page or a forced check is on its way: the refresh icon turns, nothing else moves. */
  refreshing: boolean
  /** The PRs and issues the focused worktree's agents named, newest first. */
  mentions: Mention[]
  /** When the list last showed them: what came after counts as new on the back button. */
  mentionsReadAt: number
  /** The questions the focused worktree's agents wait on that name a pull request or an issue. */
  questions: AgentQuestion[]
  /** The agent working on a pull request, by `owner/repo#N`: a terminal of the worktree on its branch. */
  agent: { key: string; terminalId: string; asking: boolean } | null
  /** The images of the page in reading order, and the one shown full size. */
  lightbox: { urls: string[]; index: number } | null
}

let state: State = {
  view: { kind: 'workspace' },
  workspace: null,
  probe: null,
  probeError: null,
  pr: null,
  issue: null,
  checkedAt: null,
  loadError: null,
  tab: 'conversation',
  busy: null,
  removing: [],
  notice: null,
  files: null,
  patches: {},
  fix: null,
  listState: 'open',
  listKind: 'pr',
  pulls: null,
  inbox: null,
  listError: null,
  listLoading: false,
  refreshing: false,
  mentions: [],
  mentionsReadAt: 0,
  questions: [],
  agent: null,
  lightbox: null
}

const listeners = new Set<() => void>()

export const getState = (): State => state

export function setState(patch: Partial<State> | ((current: State) => Partial<State>)): void {
  state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }
  for (const listener of listeners) listener()
}

/** Re-renders the calling view whenever the state changes. */
export function useAppState(): State {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    const listener = () => rerender(0)
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }, [])
  return state
}

const request = orca.plugin.request

export function openExternal(url: string): void {
  if (/^(https?:|mailto:)/i.test(url)) void orca.shell?.openExternal(url)
}

let loadedFingerprint: string | null = null
let loadedKey: string | null = null

const keyOf = (p: { repo: string; number: number }) => `${p.repo}#${p.number}`

/** The repository the list shows: the picked PR's or issue's, else the workspace's. */
export function currentRepo(): string | null {
  const view = state.view
  return view.kind === 'pr' || view.kind === 'issue' ? view.repo : (state.probe?.repo ?? null)
}

/** The workspace branch's PR, when it has one, so the list can lead back to it. */
export function workspacePullRequest(): { repo: string; number: number } | null {
  return state.probe?.status === 'found' ? { repo: state.probe.repo, number: state.probe.number } : null
}

/** The list is on screen: asked for, or standing in for a missing workspace or PR. */
export function showsList(): boolean {
  if (state.view.kind === 'list') return true
  return state.view.kind === 'workspace' && (!state.workspace || state.probe?.status === 'none')
}

function displayedKey(): string | null {
  if (state.view.kind === 'pr') return keyOf(state.view)
  const own = workspacePullRequest()
  return state.view.kind === 'workspace' && own ? keyOf(own) : null
}

function resetPullRequest(): void {
  setState({
    pr: null,
    checkedAt: null,
    loadError: null,
    files: null,
    patches: {},
    fix: null,
    notice: null,
    tab: 'conversation',
    lightbox: null
  })
  loadedFingerprint = null
  loadedKey = null
}

let inFlight = 0
/** Counts the fetches behind the refresh icon's turn, so overlapping ones keep it turning. */
async function refreshingWhile<T>(work: () => Promise<T>): Promise<T> {
  inFlight++
  setState({ refreshing: true })
  try {
    return await work()
  } finally {
    inFlight--
    if (inFlight === 0) setState({ refreshing: false })
  }
}

async function load(repo: string, number: number): Promise<void> {
  try {
    const next = await refreshingWhile(() => request('pr.get', { repo, number }, { timeoutMs: 60_000 }))
    // the user moved to another PR while this one loaded
    if (displayedKey() !== keyOf(next)) return
    const samePr = loadedKey === keyOf(next)
    setState({ pr: next, loadError: null, ...(samePr ? {} : { files: null, patches: {} }) })
    loadedKey = keyOf(next)
    if (samePr && state.files) void loadFiles(true)
  } catch (error) {
    setState({ loadError: errorText(error) })
  }
}

async function refreshDisplayed(probe: Probe, force: boolean): Promise<void> {
  if (probe.status !== 'found') return
  if (force || probe.fingerprint !== loadedFingerprint || keyOf(probe) !== loadedKey) {
    loadedFingerprint = probe.fingerprint
    await load(probe.repo, probe.number)
  }
}

/**
 * Asks the worker whether what the panel shows changed; the full page is fetched only when its
 * fingerprint did. Returns how long to wait before asking again.
 */
export async function check(force: boolean, maxAgeMs: number | null = null): Promise<number> {
  return force ? refreshingWhile(() => probeShown(true)) : probeShown(false, maxAgeMs)
}

/** Issues carry no fingerprint to compare: the open one is fetched again at this pace. */
const ISSUE_RECHECK_MS = 60_000

async function loadIssue(view: Extract<View, { kind: 'issue' }>): Promise<number> {
  try {
    const issue = await request('issue.get', { repo: view.repo, number: view.number }, { timeoutMs: 60_000 })
    if (state.view !== view) return 0
    setState({ issue, checkedAt: Date.now(), loadError: null })
  } catch (error) {
    if (state.view === view) setState({ loadError: errorText(error) })
  }
  return ISSUE_RECHECK_MS
}

async function probeShown(force: boolean, maxAgeMs: number | null = null): Promise<number> {
  const view = state.view
  if (view.kind === 'issue') return loadIssue(view)
  try {
    if (view.kind === 'pr') {
      const answer = await request('pr.probe', { target: view, force, maxAgeMs }, { timeoutMs: 60_000 })
      if (state.view !== view) return 0
      await refreshDisplayed(answer, force)
      setState({ probeError: null, checkedAt: answer.checkedAt })
      return answer.nextCheckMs
    }
    const workspace = state.workspace
    if (!workspace) return 15_000
    const answer = await request(
      'pr.probe',
      { target: { kind: 'workspace', workspace }, force, maxAgeMs },
      { timeoutMs: 60_000 }
    )
    // the focus moved while GitHub answered: this answer describes a worktree no longer shown
    if (state.workspace !== workspace) return 0
    setState({ probe: answer, probeError: null, checkedAt: answer.checkedAt })
    if (state.view.kind !== 'workspace') return Math.max(answer.nextCheckMs, 30_000)
    if (answer.status === 'none') resetPullRequest()
    else {
      // the header that came with the probe draws now; the conversation follows
      if (answer.preview && (!state.pr || keyOf(state.pr) !== keyOf(answer))) {
        setState({ pr: answer.preview })
      }
      await refreshDisplayed(answer, force)
    }
    if (state.workspace === workspace) rememberVisit()
    return answer.nextCheckMs
  } catch (error) {
    setState({ probeError: errorText(error) })
    return 30_000
  }
}

/**
 * Whether two contexts are the same worktree. Every repository's main checkout reads as branch
 * `main` named `main`, so its terminals tell them apart: a terminal opening or closing keeps one in
 * common, a switch to another worktree keeps none.
 */
export function sameWorkspace(a: WorkspaceRef | null, b: WorkspaceRef | null): boolean {
  if (!a || !b) return a === b
  if (a.branch !== b.branch || a.displayName !== b.displayName) return false
  if (a.terminalIds.length === 0 || b.terminalIds.length === 0) return a.terminalIds.length === b.terminalIds.length
  return a.terminalIds.some((id) => b.terminalIds.includes(id))
}

/**
 * What the panel last showed for each worktree it visited: going back to one draws it at once,
 * and the next probe only confirms or refreshes it.
 */
type Visit = { ref: WorkspaceRef; probe: Probe; pr: PullRequest | null; checkedAt: number | null }
const visits: Visit[] = []
const VISITS = 24

function rememberVisit(): void {
  const { workspace, probe, pr, checkedAt, view } = state
  if (!workspace || !probe || view.kind !== 'workspace') return
  const shown = probe.status === 'found' && pr && !pr.partial && keyOf(pr) === keyOf(probe) ? pr : null
  const index = visits.findIndex((visit) => sameWorkspace(visit.ref, workspace))
  if (index >= 0) visits.splice(index, 1)
  visits.unshift({ ref: workspace, probe, pr: shown, checkedAt })
  visits.length = Math.min(visits.length, VISITS)
}

export function setWorkspace(next: WorkspaceRef | null): boolean {
  const moved = !sameWorkspace(state.workspace, next)
  if (moved) rememberVisit()
  setState({ workspace: next })
  if (moved) {
    resetPullRequest()
    setState({ mentions: [], mentionsReadAt: Date.now(), questions: [] })
    const visit = next ? visits.find((each) => sameWorkspace(each.ref, next)) : undefined
    setState({ view: { kind: 'workspace' }, probe: visit?.probe ?? null, probeError: null })
    if (visit?.pr && visit.probe.status === 'found') {
      setState({ pr: visit.pr, checkedAt: visit.checkedAt })
      loadedKey = keyOf(visit.pr)
      loadedFingerprint = visit.probe.fingerprint
    }
  }
  return moved
}

/** The repository's list, of pull requests or issues: a back button leads to the kind it came from. */
export function showList(kind: ListKind = state.listKind): void {
  setState({ view: { kind: 'list' }, listKind: kind, mentionsReadAt: Date.now() })
  void loadList()
}

/** Opens an issue in the panel; what it showed before stays until the new one arrives. */
export function showIssue(repo: string, number: number): void {
  const same = state.issue && keyOf(state.issue) === keyOf({ repo, number })
  setState({
    view: { kind: 'issue', repo, number },
    notice: null,
    loadError: null,
    ...(same ? {} : { issue: null, checkedAt: null })
  })
  void check(true)
}

/** Opens a PR in the panel: the workspace's own one goes back to the workspace view. */
export function showPullRequest(repo: string, number: number): void {
  const own = workspacePullRequest()
  const view: View =
    own && keyOf(own) === keyOf({ repo, number }) ? { kind: 'workspace' } : { kind: 'pr', repo, number }
  if (loadedKey !== keyOf({ repo, number })) resetPullRequest()
  setState({ view })
  void check(true)
}

export function showWorkspace(): void {
  const own = workspacePullRequest()
  if (!own || loadedKey !== keyOf(own)) resetPullRequest()
  setState({ view: { kind: 'workspace' } })
  void check(true)
}

/** Runs one write through the worker, then refreshes the page so it shows the result. */
export async function act(label: string, action: Action): Promise<boolean> {
  const pr = state.pr
  if (!pr || state.busy) return false
  setState({ busy: label, notice: null })
  try {
    const { message } = await request('pr.action', { repo: pr.repo, number: pr.number, action }, { timeoutMs: 90_000 })
    if (message) setState({ notice: { tone: 'success', text: message } })
    await check(true)
    return true
  } catch (error) {
    setState({ notice: { tone: 'danger', text: errorText(error) } })
    return false
  } finally {
    setState({ busy: null })
  }
}

export async function openInOrca(repo: string, number: number): Promise<void> {
  setState({ busy: 'Opening in Orca', notice: null })
  try {
    const { message } = await request('inbox.open', { repo, number }, { timeoutMs: 120_000 })
    setState({ notice: { tone: 'success', text: message } })
  } catch (error) {
    setState({ notice: { tone: 'danger', text: errorText(error) } })
  } finally {
    setState({ busy: null })
  }
}

/** Deletes the focused workspace once its PR is merged; Orca then focuses another one. */
export async function removeWorkspace(): Promise<void> {
  const ref = state.workspace
  if (state.view.kind !== 'workspace' || !ref || isRemoving(ref)) return
  setState({ removing: [...state.removing, ref], notice: null })
  try {
    await request('workspace.remove', { workspace: ref }, { timeoutMs: 120_000 })
  } catch (error) {
    // the focus has usually moved on: the name says which workspace failed
    setState({ notice: { tone: 'danger', text: `Could not delete ${ref.displayName}: ${errorText(error)}` } })
  }
  setState({ removing: state.removing.filter((each) => each !== ref) })
}

export function isRemoving(ref: WorkspaceRef | null): boolean {
  return state.removing.some((each) => sameWorkspace(each, ref))
}

/** Opens a file of the workspace's own PR in Orca's editor; a picked PR's branch is not checked out here. */
export async function openFile(path: string, line: number | null = null): Promise<void> {
  if (state.view.kind !== 'workspace' || !state.workspace) return
  try {
    await request('file.open', { workspace: state.workspace, path, line })
  } catch (error) {
    setState({ notice: { tone: 'danger', text: errorText(error) } })
  }
}

/** Runs one write on the issue on screen, then fetches it again to show the result. */
export async function actOnIssue(label: string, action: IssueAction): Promise<boolean> {
  const issue = state.issue
  if (!issue || state.busy) return false
  setState({ busy: label, notice: null })
  try {
    const { message } = await request(
      'issue.action',
      { repo: issue.repo, number: issue.number, action },
      { timeoutMs: 90_000 }
    )
    if (message) setState({ notice: { tone: 'success', text: message } })
    await check(true)
    return true
  } catch (error) {
    setState({ notice: { tone: 'danger', text: errorText(error) } })
    return false
  } finally {
    setState({ busy: null })
  }
}

/** A reaction on whatever is on screen: a reaction names its subject, so both paths take it. */
export function react(subjectId: string, content: string, add: boolean): Promise<boolean> {
  const action = { kind: 'react' as const, subjectId, content, add }
  return state.view.kind === 'issue' ? actOnIssue('', action) : act('', action)
}

let filesHead: string | null = null

export async function loadFiles(force = false): Promise<void> {
  const pr = state.pr
  if (!pr || (state.files && !force)) return
  try {
    const answer = await request('pr.files', { repo: pr.repo, number: pr.number }, { timeoutMs: 90_000 })
    // open diffs stay while the head commit holds; a new push makes them stale
    const sameHead = filesHead === pr.headOid
    filesHead = pr.headOid
    setState({ files: { list: answer.files, truncated: answer.truncated }, ...(sameHead ? {} : { patches: {} }) })
  } catch (error) {
    setState({ files: { error: errorText(error) } })
  }
}

export async function loadPatch(filename: string): Promise<void> {
  const pr = state.pr
  if (!pr || filename in state.patches) return
  setState((s) => ({ patches: { ...s.patches, [filename]: 'loading' } }))
  try {
    const { patch } = await request('pr.patch', { repo: pr.repo, number: pr.number, filename })
    setState((s) => ({ patches: { ...s.patches, [filename]: patch } }))
  } catch {
    setState((s) => ({ patches: { ...s.patches, [filename]: null } }))
  }
}

async function readAgents(): Promise<Agent[]> {
  const { agents } = await orca.host.call('agents.list')
  return agents
    .filter((agent): agent is typeof agent & { terminalId: string } => agent.terminalId !== null)
    .sort((a, b) => b.stateStartedAt - a.stateStartedAt)
    .map((agent) => ({
      terminalId: agent.terminalId,
      label: `${agent.title ?? agent.agent ?? 'Agent'} (${agent.state})`
    }))
}

/** Opens the "Fix with agent" drawer: the drafted message to read and edit, and who receives it. */
export async function openFix(key: string, target: FixTarget): Promise<void> {
  const pr = state.pr
  if (!pr) return
  if (state.fix?.key === key) return setState({ fix: null })
  setState({ fix: { key, target, text: '', loading: true, agents: null, terminalId: null, error: null } })
  const [prompt, agents] = await Promise.allSettled([
    request('pr.fixPrompt', { repo: pr.repo, number: pr.number, target }, { timeoutMs: 90_000 }),
    readAgents()
  ])
  setState((s) => {
    if (s.fix?.key !== key) return {}
    const list = agents.status === 'fulfilled' ? agents.value : []
    return {
      fix: {
        ...s.fix,
        loading: false,
        text: prompt.status === 'fulfilled' ? prompt.value.text : '',
        error: prompt.status === 'rejected' ? errorText(prompt.reason) : null,
        agents: list,
        terminalId: list[0]?.terminalId ?? null
      }
    }
  })
}

export function editFix(patch: Partial<FixDraft>): void {
  setState((s) => (s.fix ? { fix: { ...s.fix, ...patch } } : {}))
}

export async function sendFix(): Promise<void> {
  const draft = state.fix
  if (!draft?.terminalId || !draft.text.trim()) return
  setState({ busy: 'Sending to agent' })
  try {
    const { accepted } = await request('agent.send', { terminalId: draft.terminalId, text: draft.text })
    if (!accepted) throw new Error('The terminal did not accept the message.')
    setState({ fix: null, notice: { tone: 'success', text: 'Sent to the agent' } })
  } catch (error) {
    editFix({ error: errorText(error) })
  } finally {
    setState({ busy: null })
  }
}

const listKey = (repo: string) => `${repo}|${state.listKind}|${state.listState}`
/** Each repository's list as last seen, shown at once while it refetches. */
const lists = new Map<string, RepoPulls>()

export function shownPulls(): RepoPulls | null {
  const repo = currentRepo()
  if (!repo) return null
  const key = listKey(repo)
  return state.pulls?.key === key ? state.pulls.data : (lists.get(key) ?? null)
}

/** Keeps what is on screen until the new answer arrives, so the list never blanks while it refetches. */
export async function loadList(force = false): Promise<void> {
  const repo = currentRepo()
  setState({ listLoading: true })
  try {
    if (!repo) {
      setState({ inbox: await request('inbox.get', { force }, { timeoutMs: 60_000 }) })
    } else {
      const key = listKey(repo)
      const cached = lists.get(key)
      if (cached && state.pulls?.key !== key) setState({ pulls: { key, data: cached } })
      const data = await request(
        'repo.list',
        { repo, state: state.listState, kind: state.listKind },
        { timeoutMs: 60_000 }
      )
      lists.set(key, data)
      if (listKey(repo) === key) setState({ pulls: { key, data } })
    }
    setState({ listError: null })
  } catch (error) {
    setState({ listError: errorText(error) })
  } finally {
    setState({ listLoading: false })
  }
}

export function setListState(listState: PullState): void {
  setState({ listState })
  void loadList()
}

export function setListKind(listKind: ListKind): void {
  setState({ listKind })
  void loadList()
}

/** Each image is fetched once per panel run; the signed query changes, the path does not. */
const images = new Map<string, Promise<string>>()
/** Three downloads at a time: a PR's screenshots arrive together instead of one after another. */
const IMAGE_LANES = 3
let running = 0
const waiting: (() => void)[] = []

async function inLane<T>(work: () => Promise<T>): Promise<T> {
  if (running >= IMAGE_LANES) await new Promise<void>((resolve) => waiting.push(resolve))
  running++
  try {
    return await work()
  } finally {
    running--
    waiting.shift()?.()
  }
}

/** Images already in hand, so a redraw puts them back at once instead of through an empty frame. */
const loaded = new Map<string, string>()
export const imageKey = (url: string) => url.split('?')[0] ?? url
export const loadedImage = (url: string) => loaded.get(imageKey(url)) ?? null

export function imageData(url: string): Promise<string> {
  const key = imageKey(url)
  let pending = images.get(key)
  if (!pending) {
    pending = inLane(() => request('pr.image', { url }, { timeoutMs: 60_000 })).then((answer) => {
      loaded.set(key, answer.dataUrl)
      return answer.dataUrl
    })
    pending.catch(() => images.delete(key))
    images.set(key, pending)
  }
  return pending
}

export function openLightbox(urls: string[], index: number): void {
  setState({ lightbox: { urls, index } })
}

export function moveLightbox(step: number): void {
  setState((s) =>
    s.lightbox
      ? {
          lightbox: {
            ...s.lightbox,
            index: (s.lightbox.index + step + s.lightbox.urls.length) % s.lightbox.urls.length
          }
        }
      : {}
  )
}

export function closeLightbox(): void {
  setState({ lightbox: null })
}

/** The mentions worth a row: the worktree's own PR is already the panel's main view. */
export function shownMentions(): Mention[] {
  const own = workspacePullRequest()
  return state.mentions.filter((mention) => !own || keyOf(mention) !== keyOf(own))
}

/** The mentioned rows by `owner/repo#N`, lower-cased as list keys compare. */
export function mentionedKeys(): Set<string> {
  return new Set(shownMentions().map((mention) => keyOf(mention).toLowerCase()))
}

/** Mentions that arrived since the list last showed them, for the back button's count. */
export function newMentions(): number {
  return shownMentions().filter((mention) => mention.seenAt > state.mentionsReadAt).length
}

/** Reads what the focused workspace's terminals show and its chats say; called when an agent ends a turn. */
export async function scanMentions(): Promise<void> {
  const workspace = state.workspace
  if (!workspace) return
  try {
    const { mentions } = await request('mentions.scan', { workspace }, { timeoutMs: 60_000 })
    // a terminal renamed meanwhile, as an agent at work does to its own, is still the same workspace
    if (!sameWorkspace(state.workspace, workspace)) return
    setState({ mentions, ...(showsList() ? { mentionsReadAt: Date.now() } : {}) })
  } catch {
    // mentions are a hint: a failed read leaves the last ones on screen
  }
}

/** The waiting question that names each row, by `owner/repo#N` lower-cased as list keys compare. */
export function askedKeys(): Map<string, AgentQuestion> {
  const asked = new Map<string, AgentQuestion>()
  // newest first: the latest question about a row is the one it shows
  for (const question of state.questions) {
    for (const item of question.items) {
      const key = keyOf(item).toLowerCase()
      if (!asked.has(key)) asked.set(key, question)
    }
  }
  return asked
}

/** Reads the questions the focused worktree's agents wait on; the worker says when one comes or goes. */
export async function loadQuestions(): Promise<void> {
  const workspace = state.workspace
  if (!workspace || workspace.terminalIds.length === 0) return
  try {
    const { questions } = await request('questions.get', { workspace })
    if (state.workspace === workspace) setState({ questions })
  } catch {
    // like mentions, a hint: a failed read leaves the last ones on screen
  }
}

/** Finds the agent working on the pull request on screen; none when no worktree in Orca is on its branch. */
export async function findAgent(pr: { repo: string; number: number; headRefName: string }): Promise<void> {
  const key = keyOf(pr)
  try {
    const found = await request('pr.agent', { repo: pr.repo, number: pr.number, headRefName: pr.headRefName })
    setState({ agent: found.terminalId ? { key, terminalId: found.terminalId, asking: found.asking } : null })
  } catch {
    // the button is a shortcut: without an answer it stays as it was
  }
}

/** Shows that agent's terminal in Orca, which then focuses its workspace. */
export async function openAgent(terminalId: string): Promise<void> {
  try {
    await request('agent.open', { terminalId })
  } catch (error) {
    setState({ agent: null, notice: { tone: 'danger', text: `Could not open the agent: ${errorText(error)}` } })
  }
}
