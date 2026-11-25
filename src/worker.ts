// The plugin's worker: every GitHub call goes through `gh` with the signed-in account, from the
// focused workspace's folder. Orca transpiles this file when it loads: no build step.
import type { OrcaWorkerApi } from 'orca/worker'
import { runAction } from './server/actions.ts'
import { fixPrompt } from './server/fix.ts'
import { fetchImage } from './server/images.ts'
import { inbox } from './server/inbox.ts'
import { fetchIssue, runIssueAction } from './server/issue.ts'
import { mentionStore, referenceBook } from './server/mentions.ts'
import { prober } from './server/probe.ts'
import { QUESTION_TOOL, questionStore } from './server/questions.ts'
import { fileStore } from './server/pull-request.ts'
import { eachLimited, pullRequestCache } from './server/cache.ts'
import {
  agents,
  agentTerminal,
  chatSessions,
  openFile,
  removeWorktree,
  resolveWorkspaceDir,
  showTerminal,
  terminals,
  worktrees
} from './server/workspace.ts'

/** `terminal.sendText` takes at most this many characters per call. */
const SEND_CHUNK = 4_000
const PASTE_START = '\u001b[200~'
const PASTE_END = '\u001b[201~'

/** Main checkouts rarely carry a PR: prefetching them would spend GitHub calls for nothing. */
const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'trunk'])
const PREFETCH_EVERY_MS = 5 * 60_000
const PREFETCH_MAX = 12
const QUESTIONS_KEY = 'questions'

/**
 * Agent TUIs read typed newlines as Enter, so a multi-line message goes in as one bracketed paste,
 * split across calls when it is long, and is submitted once at the end.
 */
async function sendToAgent(orca: OrcaWorkerApi, terminalId: string, text: string): Promise<{ accepted: boolean }> {
  // a log or comment carrying ESC[201~ would end the paste early and submit the rest line by line
  const safe = text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '')
  const pasted = `${PASTE_START}${safe}${PASTE_END}`
  for (let at = 0; at < pasted.length; at += SEND_CHUNK) {
    const last = at + SEND_CHUNK >= pasted.length
    const text = pasted.slice(at, at + SEND_CHUNK)
    const { accepted } = await orca.host.call('terminal.sendText', { terminalId, text, enter: last })
    if (!accepted) return { accepted: false }
  }
  return { accepted: true }
}

export default function activate(orca: OrcaWorkerApi): void {
  const probe = prober()
  const files = fileStore()
  const dashboard = inbox()
  const pullRequest = pullRequestCache(probe.fingerprintOf)
  const book = referenceBook()
  const mentions = mentionStore(book)

  let prefetchedAt = 0
  async function prefetch(): Promise<void> {
    const trees = (await worktrees())
      .filter((tree) => {
        const branch = tree.branch.replace(/^refs\/heads\//, '')
        return branch && !DEFAULT_BRANCHES.has(branch)
      })
      .slice(0, PREFETCH_MAX)
    await eachLimited(trees, 2, async (tree) => {
      const found = await probe.workspace(tree.path, false)
      if (found.status === 'found') await pullRequest(found.repo, found.number)
    })
  }

  const questions = questionStore({
    shelf: {
      read: () => orca.host.call('storage.get', { key: QUESTIONS_KEY }).then((stored) => stored.value),
      write: (list) => orca.host.call('storage.set', { key: QUESTIONS_KEY, value: list }).then(() => undefined)
    },
    book,
    terminalsIn: async (dir) =>
      (await terminals(true)).flatMap((row) => (row.worktreePath === dir && row.handle ? [row.handle] : [])),
    changed: () => orca.panels.post('questions.changed', {})
  })
  const logged =
    (label: string) =>
    (error: unknown): void =>
      orca.log(`${label} failed: ${String(error)}`)

  // returning nothing lets the call through at once: the question is recorded after the agent goes on
  orca.hooks.on('agent.tool.before', (event) => {
    if (event.tool !== QUESTION_TOOL || !event.terminalId) return
    void questions.ask(event.terminalId, event.input).catch(logged('question'))
  })
  orca.hooks.on('agent.tool.after', (event) => {
    if (event.tool !== QUESTION_TOOL || !event.terminalId) return
    void questions.answer(event.terminalId).catch(logged('answer'))
  })
  orca.events.on('agent.status.changed', (event) => {
    if (!event.terminalId) return
    const state = event.mainAgent?.state ?? event.state
    void questions.moved(event.terminalId, state, event.receivedAt).catch(logged('status'))
  })

  orca.panels.handle('pr.probe', async ({ target, force, maxAgeMs }) => {
    if (target.kind === 'pr') return probe.pullRequest(target.repo, target.number, force, maxAgeMs ?? undefined)
    const dir = await resolveWorkspaceDir(target.workspace)
    if (!dir) {
      return {
        status: 'none' as const,
        reason: target.workspace.branch ? 'Could not find this workspace folder.' : 'This workspace has no Git branch.',
        branch: target.workspace.branch,
        repo: null,
        nextCheckMs: 15_000,
        checkedAt: Date.now()
      }
    }
    const answer = await probe.workspace(dir, force, maxAgeMs ?? undefined)
    if (answer.status !== 'found') return answer
    const tree = (await worktrees()).find((row) => row.path === dir)
    return { ...answer, mainCheckout: tree?.isMainWorktree ?? true }
  })
  orca.panels.handle('pr.get', ({ repo, number }) => pullRequest(repo, number))
  orca.panels.handle('pr.prefetch', () => {
    if (Date.now() - prefetchedAt < PREFETCH_EVERY_MS) return { started: false }
    prefetchedAt = Date.now()
    void prefetch().catch((error: unknown) => orca.log(`prefetch failed: ${String(error)}`))
    return { started: true }
  })
  orca.panels.handle('pr.files', ({ repo, number }) => files.list(repo, number))
  orca.panels.handle('pr.patch', ({ repo, number, filename }) => files.patch(repo, number, filename))
  orca.panels.handle('pr.action', async ({ repo, number, action }) => ({
    message: await runAction(repo, number, action)
  }))
  orca.panels.handle('pr.fixPrompt', async ({ repo, number, target }) => ({
    text: await fixPrompt(repo, number, target)
  }))
  orca.panels.handle('pr.image', ({ url }) => fetchImage(url))
  orca.panels.handle('file.open', async ({ workspace, path, line }) => {
    const dir = await resolveWorkspaceDir(workspace)
    if (!dir) throw new Error('Could not find this workspace folder.')
    return openFile(dir, path, line)
  })
  orca.panels.handle('mentions.scan', async ({ workspace }) => {
    const dir = await resolveWorkspaceDir(workspace)
    const chats = chatSessions(await agents().catch(() => []), workspace)
    if (!dir && chats.length === 0) return { mentions: [] }
    return { mentions: await mentions.scan({ key: dir ?? workspace.id ?? workspace.displayName, dir, chats }) }
  })
  orca.panels.handle('questions.get', async ({ workspace }) => {
    const dir = await resolveWorkspaceDir(workspace)
    return { questions: dir ? await questions.waiting(dir) : [] }
  })
  orca.panels.handle('pr.agent', async ({ repo, number, headRefName }) => {
    const dir = await dashboard.worktreeOf(repo, headRefName)
    if (!dir) return { terminalId: null, asking: false }
    const names = (item: { repo: string; number: number }) =>
      item.number === number && item.repo.toLowerCase() === repo.toLowerCase()
    const asking = (await questions.waiting(dir)).filter((each) => each.items.some(names))
    const rows = (await terminals()).filter((row) => row.worktreePath === dir)
    return agentTerminal(
      rows,
      asking.map((each) => each.terminalId)
    )
  })
  orca.panels.handle('agent.open', ({ terminalId }) => showTerminal(terminalId))
  orca.panels.handle('workspace.remove', async ({ workspace }) => {
    await removeWorktree(workspace)
    return null
  })
  orca.panels.handle('agent.send', ({ terminalId, text }) => sendToAgent(orca, terminalId, text))
  orca.panels.handle('inbox.get', ({ force }) => dashboard.read(force))
  orca.panels.handle('repo.list', ({ repo, state, kind }) => dashboard.list(repo, state, kind))
  orca.panels.handle('issue.get', ({ repo, number }) => fetchIssue(repo, number))
  orca.panels.handle('issue.action', async ({ repo, number, action }) => ({
    message: await runIssueAction(repo, number, action)
  }))
  orca.panels.handle('inbox.open', ({ repo, number, headRefName }) => dashboard.open(repo, number, headRefName))
}
