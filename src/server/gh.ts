import { CommandError, run, type RunOptions } from './exec.ts'

export class GhError extends Error {}

const RATE_LIMITED = /rate limit|secondary rate|abuse detection/i
/** No GitHub call goes out before this time: a rate-limited token only digs its hole deeper. */
let blockedUntil = 0

async function exec(args: string[], options: RunOptions): Promise<string> {
  try {
    return await run('gh', args, options)
  } catch (error) {
    throw new GhError(error instanceof CommandError ? error.message : String(error))
  }
}

/** GET /rate_limit is exempt from the limit, so it can say when the block lifts. */
async function resetAt(): Promise<number> {
  try {
    const out = await exec(
      [
        'api',
        'rate_limit',
        '--jq',
        '[.resources.core, .resources.graphql] | map(select(.remaining == 0) | .reset) | max // 0'
      ],
      {}
    )
    const reset = Number(out.trim()) * 1000
    if (reset > Date.now()) return reset
  } catch {
    // fall through to the default pause
  }
  // secondary limits do not show in /rate_limit; GitHub asks for at least a minute
  return Date.now() + 60_000
}

const clock = (at: number) => new Date(at).toTimeString().slice(0, 5)

const blocked = () => new GhError(`GitHub rate limit reached, retrying after ${clock(blockedUntil)}`)

/** Runs `gh` with the signed-in account, stopping every call while the rate limit holds. */
export async function gh(args: string[], options: RunOptions = {}): Promise<string> {
  if (Date.now() < blockedUntil) throw blocked()
  try {
    return await exec(args, options)
  } catch (error) {
    if (error instanceof GhError && RATE_LIMITED.test(error.message)) {
      blockedUntil = await resetAt()
      throw blocked()
    }
    throw error
  }
}

export async function graphql<T>(query: string, variables: Record<string, string | number | boolean>): Promise<T> {
  const args = ['api', 'graphql', '-f', `query=${query}`]
  for (const [key, value] of Object.entries(variables)) {
    args.push(typeof value === 'string' ? '-f' : '-F', `${key}=${value}`)
  }
  const out = JSON.parse(await gh(args)) as { data?: T; errors?: { message: string; type?: string }[] }
  if (out.errors?.length) {
    // GraphQL reports its own limit in the body with a 200
    if (out.errors.some((e) => e.type === 'RATE_LIMITED')) {
      blockedUntil = await resetAt()
      throw blocked()
    }
    throw new GhError(out.errors.map((e) => e.message).join('; '))
  }
  if (!out.data) throw new GhError('GitHub returned no data')
  return out.data
}
