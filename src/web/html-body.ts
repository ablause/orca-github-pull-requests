// GitHub's rendered HTML, drawn in place. The frame runs inline scripts, so the HTML is rebuilt
// from an allowlist before it reaches the page, and images come through the worker as data URLs.
import { html, useEffect, useRef } from '../vendor/preact.mjs'
import { imageData, loadedImage, openExternal, openLightbox } from './store'

const KEPT = new Set([
  'a',
  'abbr',
  'b',
  'blockquote',
  'br',
  'code',
  'dd',
  'del',
  'details',
  'div',
  'dl',
  'dt',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'input',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'samp',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'tt',
  'ul',
  'var'
])
/** Dropped with their content: code, embeds, and GitHub's own interactive chrome. */
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'form',
  'svg',
  'math',
  'template',
  'button',
  'textarea',
  'select',
  'link',
  'meta',
  'base',
  'clipboard-copy',
  'noscript',
  'source',
  'track'
])
const ATTRIBUTES: Record<string, string[]> = {
  a: ['href', 'title'],
  img: ['alt', 'title', 'width', 'height'],
  td: ['align', 'colspan', 'rowspan'],
  th: ['align', 'colspan', 'rowspan'],
  details: ['open'],
  ol: ['start'],
  div: ['align'],
  p: ['align'],
  h1: ['align'],
  h2: ['align'],
  h3: ['align']
}
/** Classes the stylesheet draws: task lists, alerts, mentions and highlighted code. */
const KEPT_CLASS =
  /^(task-list-item|contains-task-list|user-mention|team-mention|issue-link|markdown-alert(-\w+)?|pl-\w+|highlight(-source-\w+)?)$/

const safeHref = (href: string) => /^(https?:|mailto:|#)/i.test(href.trim())

function clean(source: Element, target: Element, doc: Document): void {
  for (const node of [...source.childNodes]) {
    if (node.nodeType === Node.TEXT_NODE) {
      target.append(doc.createTextNode(node.textContent ?? ''))
      continue
    }
    if (!(node instanceof Element)) continue
    const tag = node.tagName.toLowerCase()
    if (DROPPED.has(tag)) continue
    if (tag === 'video') {
      // a video stays on GitHub: a link keeps it one press away
      const src = node.getAttribute('src')
      if (src && safeHref(src)) {
        const link = doc.createElement('a')
        link.setAttribute('href', src)
        link.textContent = 'Video: open on GitHub'
        target.append(link)
      }
      continue
    }
    if (!KEPT.has(tag)) {
      // an unknown wrapper (g-emoji, markdown-accessiblity-table) gives way to its content
      clean(node, target, doc)
      continue
    }
    if (tag === 'input' && node.getAttribute('type') !== 'checkbox') continue

    const copy = doc.createElement(tag)
    for (const name of ATTRIBUTES[tag] ?? []) {
      const value = node.getAttribute(name)
      if (value !== null && (name !== 'href' || safeHref(value))) copy.setAttribute(name, value)
    }
    const classes = (node.getAttribute('class') ?? '').split(/\s+/).filter((name) => KEPT_CLASS.test(name))
    if (classes.length) copy.setAttribute('class', classes.join(' '))
    if (tag === 'input') {
      copy.setAttribute('type', 'checkbox')
      copy.setAttribute('disabled', '')
      if (node.hasAttribute('checked')) copy.setAttribute('checked', '')
    }
    if (tag === 'img') {
      const src = node.getAttribute('src') ?? ''
      const canonical = node.getAttribute('data-canonical-src') ?? ''
      if (!/^https:/i.test(src)) continue
      copy.setAttribute('data-gh-src', src)
      if (/^https:/i.test(canonical)) copy.setAttribute('data-gh-canonical', canonical)
      const ready = loadedImage(src)
      if (ready) {
        copy.setAttribute('src', ready)
        copy.setAttribute('class', 'gh-image')
      } else copy.setAttribute('class', 'gh-image loading')
    }
    clean(node, copy, doc)
    target.append(copy)
  }
}

/** Every https image of these bodies, in reading order and once each: the PR's screenshots. */
export function imageSources(bodies: string[]): string[] {
  const seen = new Set<string>()
  const sources: string[] = []
  for (const body of bodies) {
    if (!body.includes('<img')) continue
    for (const img of new DOMParser().parseFromString(body, 'text/html').querySelectorAll('img[src]')) {
      const src = img.getAttribute('src') ?? ''
      const key = src.split('?')[0] ?? src
      if (/^https:/i.test(src) && !seen.has(key)) {
        seen.add(key)
        sources.push(src)
      }
    }
  }
  return sources
}

/** Rebuilds `source` into `root` node by node: no sanitized string is ever parsed again. */
export function renderSanitized(source: string, root: HTMLElement): void {
  const parsed = new DOMParser().parseFromString(source, 'text/html')
  root.replaceChildren()
  clean(parsed.body, root, document)
}

/** Asks for every image at once; the store's lanes decide how many download together. */
async function hydrate(root: HTMLElement): Promise<void> {
  await Promise.all(
    [...root.querySelectorAll<HTMLImageElement>('img.gh-image.loading')].map(async (img) => {
      try {
        img.src = await imageData(img.dataset.ghSrc!)
        img.classList.remove('loading')
      } catch {
        img.classList.remove('loading')
        img.classList.add('failed')
        img.alt = img.alt
          ? `${img.alt} (could not load, press to open on GitHub)`
          : 'Image could not load, press to open on GitHub'
      }
    })
  )
}

/** Every loaded image of the page, in reading order, for the viewer's previous and next. */
function pageImages(): HTMLImageElement[] {
  return [...document.querySelectorAll<HTMLImageElement>('img.gh-image')]
}

function onClick(event: MouseEvent): void {
  const target = event.target as HTMLElement
  const img = target.closest('img.gh-image') as HTMLImageElement | null
  if (img) {
    event.preventDefault()
    if (img.classList.contains('failed')) return openExternal(img.dataset.ghCanonical || img.dataset.ghSrc || '')
    const all = pageImages().filter((each) => !each.classList.contains('failed'))
    openLightbox(
      all.map((each) => each.dataset.ghSrc!),
      Math.max(0, all.indexOf(img))
    )
    return
  }
  const link = target.closest('a[href]') as HTMLAnchorElement | null
  if (link) {
    event.preventDefault()
    openExternal(link.getAttribute('href') ?? '')
  }
}

/** GitHub signs image URLs (in src and in the link around them) anew on every fetch: without the signatures, an unchanged body reads the same. */
const unsigned = (source: string) => source.replace(/(https:\/\/[^"\s?]+)\?[^"\s]*jwt=[^"\s]*/gi, '$1')

export function HtmlBody({ source, empty }: { source: string; empty?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const stable = unsigned(source)
  useEffect(() => {
    const root = ref.current
    if (!root) return
    renderSanitized(source, root)
    void hydrate(root)
    // redrawn only when the content changed, not when GitHub re-signed its images
  }, [stable])
  if (!source.trim()) return empty ? html`<p class="muted">${empty}</p>` : null
  return html`<div class="markdown-body" ref=${ref} onClick=${onClick}></div>`
}
