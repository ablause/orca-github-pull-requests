import { isAbsolute, posix, relative, resolve, sep, win32 } from 'node:path'
import type { WorkspaceRef } from '../protocol.ts'
import { run } from './exec.ts'

export type TerminalRow = { handle?: string; ptyId?: string; worktreePath?: string; agentIdentity?: string | null }
/** An agent as `orca agent list` gives it: a chat has a session to read and no terminal. */
export type AgentRow = { orcaSessionId?: string | null; kind?: string; worktreeId?: string }
export type WorktreeRow = { path: string; branch: string; displayName: string; repoId: string; isMainWorktree: boolean }

async function orcaJson<T>(args: string[], timeoutMs = 15_000): Promise<T> {
  const out = JSON.parse(await run('orca', [...args, '--json'], { timeoutMs })) as {
    ok: boolean
    result?: T
    error?: { message: string }
  }
  if (!out.ok || !out.result) throw new Error(out.error?.message ?? `orca ${args.join(' ')} failed`)
  return out.result
}

/** Orca's lists change when terminals or worktrees open and close, not between two probes. */
function cached<T>(ttlMs: number, load: () => Promise<T>): (fresh?: boolean) => Promise<T> {
  let last: { at: number; value: Promise<T> } | null = null
  return (fresh = false) => {
    if (fresh || !last || Date.now() - last.at > ttlMs) {
      const value = load()
      last = { at: Date.now(), value }
      value.catch(() => {
        last = null
      })
    }
    return last.value
  }
}

export const terminals = cached(10_000, () =>
  orcaJson<{ terminals: TerminalRow[] }>(['terminal', 'list']).then((r) => r.terminals)
)
export const worktrees = cached(10_000, () =>
  orcaJson<{ worktrees: WorktreeRow[] }>(['worktree', 'list', '--limit', '500']).then((r) => r.worktrees)
)

export const agents = cached(10_000, () => orcaJson<{ agents: AgentRow[] }>(['agent', 'list']).then((r) => r.agents))

/**
 * The chats open in a workspace, by the session `orca agent read` takes. A chat is no terminal and
 * a bot's workspace is a folder no worktree lists, so only the workspace's own id finds them.
 */
export function chatSessions(rows: AgentRow[], workspace: WorkspaceRef): string[] {
  if (!workspace.id) return []
  return rows.flatMap((row) =>
    row.kind === 'chat' && row.worktreeId === workspace.id && row.orcaSessionId ? [row.orcaSessionId] : []
  )
}

const shortBranch = (ref: string) => ref.replace(/^refs\/heads\//, '')

/**
 * The folder of the focused workspace. `workspace.readContext` gives no path, only its branch,
 * name and terminals: a terminal names its worktree exactly, the branch and name are the fallback.
 */
export async function resolveWorkspaceDir(workspace: WorkspaceRef): Promise<string | null> {
  if (workspace.terminalIds.length > 0) {
    const ids = new Set(workspace.terminalIds)
    const match = (rows: TerminalRow[]) =>
      rows.find(
        (terminal) => (terminal.handle && ids.has(terminal.handle)) || (terminal.ptyId && ids.has(terminal.ptyId))
      )
    // a terminal opened since the list was read is not in it yet: read it again once
    const row = match(await terminals().catch(() => [])) ?? match(await terminals(true).catch(() => []))
    if (row?.worktreePath) return row.worktreePath
  }
  const onBranch = (await worktrees()).filter((tree) => shortBranch(tree.branch) === workspace.branch)
  const named = onBranch.filter((tree) => tree.displayName === workspace.displayName)
  return (named[0] ?? (onBranch.length === 1 ? onBranch[0] : undefined))?.path ?? null
}

/**
 * A path from the PR, normalized relative to the worktree. GitHub paths use forward slashes, so a
 * backslash, a parent segment, an absolute path or a leading dash (read as a CLI option) is refused.
 */
export function insideWorktree(dir: string, path: string): string | null {
  if (!path || path.startsWith('-') || path.includes('\\') || /^[a-z]:/i.test(path)) return null
  if (posix.isAbsolute(path) || win32.isAbsolute(path) || path.split('/').includes('..')) return null
  const rel = relative(dir, resolve(dir, path))
  return rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? rel : null
}

export async function openFile(dir: string, path: string, line: number | null): Promise<{ opened: boolean }> {
  const target = insideWorktree(dir, path)
  if (!target) throw new Error('This path is outside the worktree.')
  const args = ['file', 'open', target, '--worktree', `path:${dir}`, '--focus']
  if (line && line > 0) args.push('--line', String(line))
  await orcaJson(args)
  return { opened: true }
}

/**
 * Removes a merged PR's worktree the way Orca's own "Delete Workspace" does: its archive hooks run,
 * uncommitted changes block it, and the local branch goes only when Git proves it merged.
 */
export async function removeWorktree(workspace: WorkspaceRef): Promise<void> {
  const dir = await resolveWorkspaceDir(workspace)
  if (!dir) throw new Error('Could not find this workspace folder.')
  // archive hooks and stopping the workspace's terminals take longer than a list
  await orcaJson(['worktree', 'rm', '--worktree', `path:${dir}`, '--delete-branch', '--run-hooks'], 110_000)
}

/**
 * The agent to show for a worktree: the one whose question names the pull request, else its first
 * agent. A plain shell is no agent: the worktree itself is then what there is to open.
 */
export function agentTerminal(rows: TerminalRow[], asking: string[]): { terminalId: string | null; asking: boolean } {
  const agents = rows.flatMap((row) => (row.handle && row.agentIdentity ? [row.handle] : []))
  const asker = agents.find((handle) => asking.includes(handle))
  return { terminalId: asker ?? agents[0] ?? null, asking: asker !== undefined }
}

/** Shows a terminal's workspace and its tab in Orca, as clicking it does. */
export async function showTerminal(handle: string): Promise<{ opened: boolean }> {
  // the handle goes on a command line: only one Orca listed is passed on
  if (!(await terminals(true)).some((row) => row.handle === handle)) throw new Error('This terminal is closed.')
  await orcaJson(['terminal', 'switch', '--terminal', handle])
  return { opened: true }
}
