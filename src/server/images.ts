import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { run } from './exec.ts'
import { gh } from './gh.ts'

/**
 * Where GitHub serves the images of PR descriptions and comments. The panel has no network, so
 * the worker fetches for it, and only from here: it must not become a proxy for any URL.
 */
const IMAGE_HOSTS = [/^([a-z0-9-]+\.)*githubusercontent\.com$/i, /^github\.com$/i]

export function isGitHubImageUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && IMAGE_HOSTS.some((host) => host.test(url.hostname))
  } catch {
    return false
  }
}

/** A panel answer holds 1 MiB of JSON and base64 adds a third: larger images are shrunk first. */
const MAX_BYTES = 700 * 1024
const SHRINK_STEPS = [1600, 1000, 640]
const MAX_DOWNLOAD = 25 * 1024 * 1024

const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml'
}

let token: Promise<string | null> | null = null
/** github.com attachment links need the signed-in account; githubusercontent.com ones are pre-signed. */
const authToken = () =>
  (token ??= gh(['auth', 'token']).then(
    (out) => out.trim() || null,
    () => null
  ))

/** github.com attachments redirect to GitHub's own S3 buckets, which sign the URL themselves. */
const GITHUB_BUCKET = /^github-[a-z0-9-]+\.s3\.amazonaws\.com$/i
const MAX_REDIRECTS = 3

function allowedHop(url: URL): boolean {
  return url.protocol === 'https:' && (isGitHubImageUrl(url.href) || GITHUB_BUCKET.test(url.hostname))
}

/** Each redirect is checked before it is followed, and the token only ever goes to github.com. */
async function fetchFollowing(start: string): Promise<Response> {
  let url = new URL(start)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!allowedHop(url)) throw new Error('The image redirected outside GitHub')
    const headers: Record<string, string> = { 'User-Agent': 'orca-github-plugin' }
    if (url.hostname === 'github.com') {
      const value = await authToken()
      if (value) headers.Authorization = `token ${value}`
    }
    const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) })
    const location = response.headers.get('location')
    if (response.status < 300 || response.status >= 400 || !location) return response
    await response.body?.cancel()
    url = new URL(location, url)
  }
  throw new Error('The image redirected too many times')
}

/** Counts bytes as they arrive: a missing or false Content-Length cannot get past the limit. */
async function readCapped(response: Response): Promise<Buffer> {
  if (Number(response.headers.get('content-length') ?? 0) > MAX_DOWNLOAD) {
    await response.body?.cancel()
    throw new Error('The image is too large to show here')
  }
  const reader = response.body?.getReader()
  if (!reader) return Buffer.alloc(0)
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > MAX_DOWNLOAD) {
      await reader.cancel()
      throw new Error('The image is too large to show here')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

async function download(url: string): Promise<{ bytes: Buffer; type: string }> {
  const response = await fetchFollowing(url)
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`GitHub answered ${response.status} for this image`)
  }
  const bytes = await readCapped(response)
  const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? 'application/octet-stream'
  return { bytes, type }
}

/** macOS ships `sips`; elsewhere a large image stays a link to GitHub. */
async function shrink(bytes: Buffer): Promise<Buffer | null> {
  if (process.platform !== 'darwin') return null
  const dir = await mkdtemp(join(tmpdir(), 'orca-github-image-'))
  try {
    const source = join(dir, 'source')
    await writeFile(source, bytes)
    for (const size of SHRINK_STEPS) {
      const target = join(dir, `shrunk-${size}.jpg`)
      await run(
        'sips',
        ['-Z', String(size), '-s', 'format', 'jpeg', '-s', 'formatOptions', '80', source, '--out', target],
        {
          timeoutMs: 30_000
        }
      )
      const shrunk = await readFile(target)
      if (shrunk.length <= MAX_BYTES) return shrunk
    }
    return null
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function typeOf(type: string, url: string): string {
  if (type.startsWith('image/')) return type
  const extension = /\.([a-z0-9]+)(?:$|\?)/i.exec(new URL(url).pathname)?.[1]?.toLowerCase()
  return (extension && TYPES[extension]) ?? 'image/png'
}

/** Recently shown images, by URL without its signature, which changes on every page load. */
const cache = new Map<string, string>()
const CACHE_SIZE = 40

export async function fetchImage(url: string): Promise<{ dataUrl: string }> {
  if (!isGitHubImageUrl(url)) throw new Error('Only GitHub images are loaded')
  const key = url.split('?')[0] ?? url
  const hit = cache.get(key)
  if (hit) return { dataUrl: hit }

  const { bytes, type } = await download(url)
  let body = bytes
  let mime = typeOf(type, url)
  if (bytes.length > MAX_BYTES) {
    const shrunk = await shrink(bytes)
    if (!shrunk) throw new Error('The image is too large to show here')
    body = shrunk
    mime = 'image/jpeg'
  }
  const dataUrl = `data:${mime};base64,${body.toString('base64')}`
  cache.set(key, dataUrl)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return { dataUrl }
}
