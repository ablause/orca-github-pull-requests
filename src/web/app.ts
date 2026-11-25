import { html, useEffect } from '../vendor/preact.mjs'
import {
  check,
  currentRepo,
  getState,
  loadList,
  loadQuestions,
  scanMentions,
  setWorkspace,
  showsList,
  useAppState
} from './store'
import { IssueView } from './views/issue'
import { Lightbox } from './views/lightbox'
import { ListView } from './views/list'
import { PullRequestView } from './views/pull-request'

/** How often a hidden panel looks again whether it is shown; it asks the worker nothing meanwhile. */
const HIDDEN_RECHECK_MS = 2_000
/** The list refreshes at GitHub search's pace, slower than a PR's state. */
const LIST_REFRESH_MS = 60_000
/** What the user comes back to, a worktree or the panel itself, is read again past this age. */
const RETURN_MAX_AGE_MS = 15_000

/** Polls while the panel is visible, at the pace the worker asks for, and follows the focused workspace. */
function usePolling(): void {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    let generation = 0
    let listLoadedAt = 0
    let listedRepo: string | null | undefined
    // Orca replays the current context on subscribe: that first one always loads, even when it is null
    let seen = false

    const schedule = (ms: number) => {
      clearTimeout(timer)
      timer = setTimeout(() => void tick(false), ms)
    }

    async function tick(force: boolean, maxAgeMs: number | null = null): Promise<void> {
      if (document.hidden) return schedule(HIDDEN_RECHECK_MS)
      const mine = ++generation
      const next = await check(force, maxAgeMs)
      // the worker keeps every worktree's PR warm, at most every few minutes
      void orca.plugin.request('pr.prefetch', {}).catch(() => undefined)
      // 0: the answer was for a worktree no longer focused, so ask again for the current one
      if (next === 0) {
        if (mine === generation) schedule(0)
        return
      }
      const repo = currentRepo()
      if (showsList() && (force || repo !== listedRepo || Date.now() - listLoadedAt > LIST_REFRESH_MS)) {
        listLoadedAt = Date.now()
        listedRepo = repo
        // a chat ends its turns unheard, a bot's above all: what it names is read again with the list
        if (getState().workspace?.terminalIds.length === 0) void scanMentions()
        await loadList()
      }
      // a workspace switch started a newer tick meanwhile: let that one schedule
      if (mine === generation) schedule(next)
    }

    const subscription = orca.on('workspace.changed', ({ context }) => {
      const next = context
        ? {
            id: context.workspaceId ?? null,
            branch: context.branch,
            displayName: context.displayName,
            terminalIds: context.terminals.map((t) => t.id)
          }
        : null
      // a switch reuses what the worker read moments ago: only Refresh and writes force GitHub
      if (setWorkspace(next) || !seen) {
        seen = true
        void tick(false, RETURN_MAX_AGE_MS)
        void scanMentions()
        void loadQuestions()
      }
    })
    // the worker hears a question being asked and answered, in any worktree: read this one's again
    const questions = orca.plugin.on('questions.changed', () => {
      if (!document.hidden) void loadQuestions()
    })
    // an agent that ends its turn has just written what it names: read it once, never while it works.
    // Only the focused worktree's terminals are read, so a turn ending elsewhere costs one cheap read.
    let scanTimer: ReturnType<typeof setTimeout> | undefined
    const agents = orca.on('agent.status.changed', (event) => {
      if (event.state === 'working' || document.hidden) return
      clearTimeout(scanTimer)
      scanTimer = setTimeout(() => void scanMentions(), 1_000)
    })
    const onVisible = () => {
      if (document.hidden || !getState().workspace) return
      void tick(false, RETURN_MAX_AGE_MS)
      void scanMentions()
      void loadQuestions()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(timer)
      clearTimeout(scanTimer)
      subscription.dispose()
      agents.dispose()
      questions.dispose()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])
}

function Body() {
  const state = useAppState()
  const { view, pr, issue, probe, probeError, loadError, workspace } = state
  if (view.kind === 'list') return html`<${ListView} />`
  if (view.kind === 'issue') {
    if (issue) return html`<${IssueView} issue=${issue} />`
    if (loadError)
      return html`<p class="notice danger" style="margin-top:12px">Could not load the issue: ${loadError}</p>`
    return html`<p class="empty">Loading the issue...</p>`
  }
  if (view.kind === 'workspace' && !workspace) return html`<${ListView} reason="No workspace is focused" />`
  if (pr) return html`<${PullRequestView} pr=${pr} />`
  if (view.kind === 'workspace' && probe?.status === 'none') {
    return html`<${ListView} reason=${probe.branch ? `No pull request for ${probe.branch}` : probe.reason} />`
  }
  if (probeError)
    return html`<p class="notice danger" style="margin-top:12px">Could not reach GitHub: ${probeError}</p>`
  if (loadError)
    return html`<p class="notice danger" style="margin-top:12px">Could not load the pull request: ${loadError}</p>`
  return html`<p class="empty">Loading the pull request...</p>`
}

export function App() {
  usePolling()
  return html`<main>
    <${Body} />
    <${Lightbox} />
  </main>`
}
