import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** A GUI app does not inherit the login shell's PATH, so Homebrew and the Orca CLI are added. */
const EXTRA_PATH = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/Applications/Orca.app/Contents/Resources/bin',
  join(process.env.HOME ?? '', '.local/bin')
]

const PATH = [...(process.env.PATH ?? '').split(delimiter), ...EXTRA_PATH].filter(Boolean).join(delimiter)

const resolved = new Map<string, string>()

function which(command: string): string {
  const cached = resolved.get(command)
  if (cached) return cached
  const found = PATH.split(delimiter)
    .map((dir) => join(dir, command))
    .find((candidate) => existsSync(candidate))
  const path = found ?? command
  resolved.set(command, path)
  return path
}

export class CommandError extends Error {
  constructor(
    message: string,
    readonly missing = false
  ) {
    super(message)
  }
}

export type RunOptions = { cwd?: string; input?: string; timeoutMs?: number }

/** Runs a CLI and rejects with its first stderr line, so the panel can say why. */
export function run(command: string, args: string[], options: RunOptions = {}): Promise<string> {
  const timeout = options.timeoutMs ?? 30_000
  return new Promise((resolve, reject) => {
    const child = execFile(
      which(command),
      args,
      { cwd: options.cwd, timeout, maxBuffer: 32 * 1024 * 1024, env: { ...process.env, PATH } },
      (error, stdout, stderr) => {
        if (!error) return resolve(stdout)
        const code = (error as NodeJS.ErrnoException).code
        const cause =
          code === 'ENOENT'
            ? `${command} is not installed or not on the PATH`
            : error.killed
              ? `${command} timed out after ${timeout} ms`
              : (stderr
                  .trim()
                  .split('\n')
                  .find((line) => line.trim()) ?? error.message)
        reject(new CommandError(cause, code === 'ENOENT'))
      }
    )
    if (options.input !== undefined) child.stdin?.end(options.input)
  })
}

export function git(dir: string, ...args: string[]): Promise<string | null> {
  return run('git', ['-C', dir, ...args], { timeoutMs: 5_000 }).then(
    (out) => out.trim(),
    () => null
  )
}
