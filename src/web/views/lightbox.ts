// An image shown full size over the panel, with the PR's other images one key away. It opens fitted
// to the panel; a click toggles real size at the point clicked, a mouse wheel or a pinch zooms around
// the pointer, and a drag, a trackpad scroll or the arrow keys pan the zoomed image.
import { html, useEffect, useLayoutEffect, useRef, useState } from '../../vendor/preact.mjs'
import { Icon } from '../icon'
import { closeLightbox, imageData, loadedImage, moveLightbox, openExternal, useAppState } from '../store'

const MAX_SCALE = 8
const STEP = 1.5
const DRAG_THRESHOLD = 4
const PAN_STEP = 60
/** A trackpad keeps sending events after the fingers lift; they belong to the gesture that started them. */
const GESTURE_GAP_MS = 250
const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}

/**
 * Browsers do not say which device scrolled. A trackpad scrolls in fine pixel steps, often sideways
 * too, and Chromium reports its legacy `wheelDeltaY` as exactly -3 times `deltaY`; a mouse wheel
 * moves in whole notches.
 */
function fromTrackpad(event: WheelEvent): boolean {
  if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) return false
  if (event.deltaX !== 0 || !Number.isInteger(event.deltaY)) return true
  const legacy = (event as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
  return legacy !== undefined && legacy !== 0 && legacy === -3 * event.deltaY
}

/** A click on the stage's scrollbars lands on the stage itself and must not close the viewer. */
function onScrollbar(event: MouseEvent): boolean {
  const stage = event.currentTarget as HTMLElement
  const box = stage.getBoundingClientRect()
  return event.clientX - box.left >= stage.clientWidth || event.clientY - box.top >= stage.clientHeight
}

type Size = { w: number; h: number }
/** A point of the image, as fractions of its size, to keep under a point of the stage. */
type Anchor = { fx: number; fy: number; sx: number; sy: number }

export function Lightbox() {
  const { lightbox } = useAppState()
  const [data, setData] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [natural, setNatural] = useState<Size | null>(null)
  const [stage, setStage] = useState<Size | null>(null)
  const [zoom, setZoom] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const anchor = useRef<Anchor | null>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const trackpad = useRef({ until: 0 })
  const url = lightbox ? lightbox.urls[lightbox.index] : undefined

  const fit = natural && stage ? Math.min(1, stage.w / natural.w, stage.h / natural.h) : 1
  const scale = zoom ?? fit
  const current = useRef({ fit, scale })
  current.current = { fit, scale }

  useEffect(() => {
    if (!url) return
    let live = true
    setData(loadedImage(url))
    setFailed(false)
    setNatural(null)
    setZoom(null)
    imageData(url).then(
      (value) => live && setData(value),
      () => live && setFailed(true)
    )
    return () => {
      live = false
    }
  }, [url])

  useEffect(() => {
    const element = stageRef.current
    if (!element) return
    const observer = new ResizeObserver(() => setStage({ w: element.clientWidth, h: element.clientHeight }))
    observer.observe(element)
    return () => observer.disconnect()
  }, [lightbox !== null])

  useEffect(() => {
    if (zoom !== null && zoom <= fit * 1.001) setZoom(null)
  }, [fit])

  useLayoutEffect(() => {
    const element = stageRef.current
    const image = imageRef.current
    const target = anchor.current
    anchor.current = null
    if (!element || !image || !target) return
    element.scrollLeft = image.offsetLeft + target.fx * image.offsetWidth - target.sx
    element.scrollTop = image.offsetTop + target.fy * image.offsetHeight - target.sy
  }, [scale])

  /** Zooms to `next`, keeping the image point under the client point (the stage's centre by default) in place. */
  const zoomTo = (next: number, client?: { x: number; y: number }) => {
    const element = stageRef.current
    const image = imageRef.current
    if (!element || !image || !natural) return
    const { fit } = current.current
    const clamped = Math.min(Math.max(next, fit), Math.max(MAX_SCALE, fit))
    const box = element.getBoundingClientRect()
    const picture = image.getBoundingClientRect()
    const x = client?.x ?? box.left + box.width / 2
    const y = client?.y ?? box.top + box.height / 2
    anchor.current = {
      fx: Math.min(Math.max((x - picture.left) / picture.width, 0), 1),
      fy: Math.min(Math.max((y - picture.top) / picture.height, 0), 1),
      sx: x - box.left,
      sy: y - box.top
    }
    current.current = { fit, scale: clamped }
    setZoom(clamped <= fit * 1.001 ? null : clamped)
  }

  useEffect(() => {
    if (!lightbox) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select')) return
      if (event.ctrlKey || event.metaKey || event.altKey) return
      if (event.key === 'Escape') return closeLightbox()
      const arrow = ARROWS[event.key]
      if (arrow && zoom !== null) {
        event.preventDefault()
        return stageRef.current?.scrollBy(arrow[0] * PAN_STEP, arrow[1] * PAN_STEP)
      }
      if (event.key === 'ArrowRight') moveLightbox(1)
      if (event.key === 'ArrowLeft') moveLightbox(-1)
      if (event.key === '+' || event.key === '=') zoomTo(current.current.scale * STEP)
      if (event.key === '-') zoomTo(current.current.scale / STEP)
      if (event.key === '0') zoomTo(0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!lightbox || !url) return null
  const many = lightbox.urls.length > 1
  const zoomed = zoom !== null

  const onPointerDown = (event: PointerEvent) => {
    const element = stageRef.current
    if (event.button !== 0 || !element) return
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: element.scrollLeft,
      top: element.scrollTop,
      moved: false
    }
  }
  const onPointerMove = (event: PointerEvent) => {
    const element = stageRef.current
    const start = drag.current
    if (!element || !start || !zoomed) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return
    if (!start.moved) {
      start.moved = true
      element.setPointerCapture(event.pointerId)
      setDragging(true)
    }
    element.scrollLeft = start.left - dx
    element.scrollTop = start.top - dy
  }
  const onPointerUp = () => {
    if (drag.current?.moved) setDragging(false)
  }
  const onClick = (event: MouseEvent) => {
    event.stopPropagation()
    const moved = drag.current?.moved
    drag.current = null
    if (moved) return
    if (event.target !== imageRef.current) return onScrollbar(event) ? undefined : closeLightbox()
    if (zoomed) return zoomTo(0)
    zoomTo(fit < 1 ? 1 : fit * 2, { x: event.clientX, y: event.clientY })
  }
  const onWheel = (event: WheelEvent) => {
    const pinch = event.ctrlKey || event.metaKey
    if (!pinch && (event.timeStamp < trackpad.current.until || fromTrackpad(event))) {
      trackpad.current.until = event.timeStamp + GESTURE_GAP_MS
      return
    }
    event.preventDefault()
    const delta = Math.min(Math.max(event.deltaY, -50), 50)
    zoomTo(current.current.scale * Math.exp(-delta * 0.01), { x: event.clientX, y: event.clientY })
  }

  const size = natural ? { width: `${natural.w * scale}px`, height: `${natural.h * scale}px` } : undefined
  return html`<div class="lightbox" role="dialog" aria-label="Image viewer" onClick=${closeLightbox}>
    <div class="lightbox-bar" onClick=${(e: Event) => e.stopPropagation()}>
      <div class="row">
        <span class="muted">${lightbox.index + 1} / ${lightbox.urls.length}</span>
        <div class="row zoom-controls">
          <button
            class="icon-btn"
            aria-label="Zoom out"
            title="Zoom out (-)"
            disabled=${!zoomed}
            onClick=${() => zoomTo(scale / STEP)}
          >
            <${Icon} name="zoomOut" size=${14} />
          </button>
          <button
            class="btn ghost sm zoom-level"
            title="Fit to panel (0)"
            aria-label=${`Fit to panel, now ${Math.round(scale * 100)}%`}
            disabled=${!zoomed}
            onClick=${() => zoomTo(0)}
          >
            ${Math.round(scale * 100)}%
          </button>
          <button
            class="icon-btn"
            aria-label="Zoom in"
            title="Zoom in (+)"
            disabled=${!natural || scale >= Math.max(MAX_SCALE, fit)}
            onClick=${() => zoomTo(scale * STEP)}
          >
            <${Icon} name="zoomIn" size=${14} />
          </button>
        </div>
      </div>
      <div class="row">
        ${
          many
            ? html`<button
                  class="icon-btn"
                  title="Previous (Left arrow)"
                  aria-label="Previous"
                  onClick=${() => moveLightbox(-1)}
                >
                  <${Icon} name="chevronLeft" />
                </button>
                <button class="icon-btn" title="Next (Right arrow)" aria-label="Next" onClick=${() => moveLightbox(1)}>
                  <${Icon} name="chevronRight" />
                </button>`
            : null
        }
        <button class="icon-btn" title="Open on GitHub" aria-label="Open on GitHub" onClick=${() => openExternal(url)}>
          <${Icon} name="externalLink" />
        </button>
        <button class="icon-btn" title="Close (Esc)" aria-label="Close" onClick=${closeLightbox}>
          <${Icon} name="x" />
        </button>
      </div>
    </div>
    <div
      ref=${stageRef}
      class=${`lightbox-stage${zoomed ? ' zoomed' : ''}${dragging ? ' dragging' : ''}`}
      onPointerDown=${onPointerDown}
      onPointerMove=${onPointerMove}
      onPointerUp=${onPointerUp}
      onPointerCancel=${onPointerUp}
      onClick=${onClick}
      onWheel=${onWheel}
    >
      ${
        failed
          ? html`<div class="lightbox-failed">
              <p class="muted">Could not load this image.</p>
              <button class="btn outline sm" onClick=${() => openExternal(url)}>Open on GitHub</button>
            </div>`
          : data
            ? html`<img
                ref=${imageRef}
                src=${data}
                alt=""
                draggable=${false}
                class=${natural ? '' : 'pending'}
                style=${size}
                onLoad=${(e: Event) => {
                  const image = e.currentTarget as HTMLImageElement
                  setNatural({ w: image.naturalWidth || 300, h: image.naturalHeight || 150 })
                }}
                onError=${() => setFailed(true)}
              />`
            : html`<p class="muted">Loading...</p>`
      }
    </div>
  </div>`
}
