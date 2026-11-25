// The questions agents are waiting on, as Claude Code asks them with AskUserQuestion. Orca's tool
// hooks hear each one being asked and answered, with its exact wording and its terminal, so nothing
// is guessed from the screen. They live in the plugin's store: an idle worker stops while the
// question still waits.
import type { AgentQuestion } from '../protocol.ts'
import { extractMentions, type ReferenceBook } from './mentions.ts'

export const QUESTION_TOOL = 'AskUserQuestion'

/** What is kept of a question: the wording to show, and every string of it to read references from. */
export type Asked = { terminalId: string; askedAt: number; text: string; body: string }

/** Where the questions outlive the worker. */
export type Shelf = { read(): Promise<unknown>; write(list: Asked[]): Promise<void> }

type Deps = {
  shelf: Shelf
  book: ReferenceBook
  /** The handles of the terminals in a worktree folder. */
  terminalsIn(dir: string): Promise<string[]>
  /** A question was asked, answered or dropped. */
  changed(): void
}

const KEEP = 50
const MAX_TEXT = 500
const MAX_BODY = 8_000
/** A question nobody answered in this long belongs to a session that is gone. */
const EXPIRES_MS = 14 * 24 * 3_600_000

/** Every string of a tool input: references hide in headers, option labels and descriptions too. */
function stringsOf(value: unknown, depth = 0): string[] {
  if (typeof value === 'string') return [value]
  if (depth > 6 || !value || typeof value !== 'object') return []
  return Object.values(value).flatMap((each) => stringsOf(each, depth + 1))
}

export function readQuestion(input: unknown): { text: string; body: string } | null {
  const questions = (input as { questions?: unknown } | null)?.questions
  const first = Array.isArray(questions) ? (questions[0] as { question?: unknown } | null)?.question : null
  const strings = stringsOf(input)
  const text = (typeof first === 'string' && first.trim()) || strings[0]?.trim()
  return text ? { text: text.slice(0, MAX_TEXT), body: strings.join('\n').slice(0, MAX_BODY) } : null
}

function isAsked(value: unknown): value is Asked {
  const row = value as Partial<Asked> | null
  return (
    typeof row?.terminalId === 'string' &&
    typeof row.askedAt === 'number' &&
    typeof row.text === 'string' &&
    typeof row.body === 'string'
  )
}

export function questionStore({ shelf, book, terminalsIn, changed }: Deps) {
  let asked: Promise<Asked[]> | null = null
  /** Hooks and status events arrive side by side: each change waits for the one before it. */
  let last: Promise<void> = Promise.resolve()

  function all(): Promise<Asked[]> {
    asked ??= shelf.read().then(
      (stored) => (Array.isArray(stored) ? stored.filter(isAsked) : []),
      () => []
    )
    return asked
  }

  function change(edit: (list: Asked[]) => Asked[] | null): Promise<void> {
    last = last.then(async () => {
      const next = edit(await all())
      if (!next) return
      asked = Promise.resolve(next)
      // a store that refuses the write costs the question on the next restart, not now
      await shelf.write(next).catch(() => undefined)
      changed()
    })
    return last
  }

  /** The agent of this terminal asks: one question waits per terminal, the newest. */
  function ask(terminalId: string, input: unknown, now = Date.now()): Promise<void> {
    const read = readQuestion(input)
    if (!read) return Promise.resolve()
    return change((list) =>
      [
        ...list.filter((each) => each.terminalId !== terminalId && now - each.askedAt < EXPIRES_MS),
        { terminalId, askedAt: now, ...read }
      ].slice(-KEEP)
    )
  }

  /** The question of this terminal was answered. */
  function answer(terminalId: string): Promise<void> {
    return change((list) => {
      const next = list.filter((each) => each.terminalId !== terminalId)
      return next.length === list.length ? null : next
    })
  }

  /**
   * A dismissed question tells no hook. The agent's status does: it waits while the question is
   * open, so working again or done since then means nobody is asked anything any more.
   */
  function moved(terminalId: string, state: string, at: number): Promise<void> {
    if (state !== 'working' && state !== 'done') return Promise.resolve()
    return change((list) => {
      const next = list.filter((each) => each.terminalId !== terminalId || each.askedAt >= at)
      return next.length === list.length ? null : next
    })
  }

  /** The questions waiting in a worktree that name a pull request or an issue, newest first. */
  async function waiting(dir: string): Promise<AgentQuestion[]> {
    const list = await all()
    if (list.length === 0) return []
    const here = new Set(await terminalsIn(dir))
    const mine = list.filter((each) => here.has(each.terminalId))
    if (mine.length === 0) return []
    const repo = await book.repoOf(dir)
    const read = await Promise.all(
      mine.map(async ({ terminalId, askedAt, text, body }) => ({
        terminalId,
        askedAt,
        text,
        items: await book.resolve(extractMentions(body, repo, true))
      }))
    )
    return read.filter((each) => each.items.length > 0).sort((a, b) => b.askedAt - a.askedAt)
  }

  return { ask, answer, moved, waiting }
}
