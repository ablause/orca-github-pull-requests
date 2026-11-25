// One issue in the panel, drawn like the pull request view without what only a PR has (merge
// state, checks, files): its header, the pull requests that close it, then its conversation.
import type { Issue } from '../../protocol'
import { freshness } from '../../ui/format'
import { html, useState } from '../../vendor/preact.mjs'
import { Icon } from '../icon'
import { actOnIssue, check, openExternal, showList, useAppState } from '../store'
import { AskedHere, Description, Entry, ImageStrip, issueIcon, LinkedItems, NewMentions } from './pull-request'

function stateLabel(issue: Issue): string {
  if (issue.state === 'OPEN') return 'Open'
  return issue.stateReason === 'NOT_PLANNED' ? 'Not planned' : 'Closed'
}

/** GitHub's label colour as a dot: the name stays in the panel's own text colour, readable in both themes. */
function Labels({ issue }: { issue: Issue }) {
  if (issue.labels.length === 0 && issue.assignees.length === 0) return null
  return html`<div class="meta-row">
    ${issue.labels.map(
      (label) =>
        html`<span class="label" key=${label.name}>
          <span class="dot" style=${`background:#${/^[0-9a-f]{6}$/i.test(label.color) ? label.color : '888888'}`}></span
          >${label.name}
        </span>`
    )}
    ${
      issue.assignees.length > 0
        ? html`<span class="xxs muted">Assigned to ${issue.assignees.map((a) => a.login).join(', ')}</span>`
        : null
    }
  </div>`
}

function Header({ issue }: { issue: Issue }) {
  const { checkedAt, refreshing } = useAppState()
  const icon = issueIcon(issue)
  return html`<div class="topbar">
      <button class="btn ghost sm back" onClick=${() => showList('issue')}>
        <${Icon} name="chevronLeft" size=${14} />Issues<${NewMentions} />
      </button>
      <span class="grow"></span>
      ${checkedAt ? html`<span class="xxs muted">Updated ${freshness(checkedAt)}</span>` : null}
      <button class="icon-btn" title="Refresh" aria-label="Refresh" onClick=${() => check(true)}>
        <${Icon} name="refreshCw" class=${refreshing ? 'spin' : ''} />
      </button>
      <button
        class="icon-btn"
        title="Open on GitHub"
        aria-label="Open on GitHub"
        onClick=${() => openExternal(issue.url)}
      >
        <${Icon} name="externalLink" />
      </button>
    </div>
    <header class="header">
      <div class="pr-id">
        <${Icon} name=${icon.name} class=${`tone-${icon.tone}`} />
        <span class="number">#${issue.number}</span>
        <span class=${`badge ${icon.tone}`}>${stateLabel(issue)}</span>
        <${AskedHere} repo=${issue.repo} number=${issue.number} />
      </div>
      <h1>${issue.title}</h1>
      <${Labels} issue=${issue} />
      <${LinkedItems} verb="Linked pull requests" items=${issue.linkedPulls} />
    </header>`
}

/** Comment, and close or reopen, as GitHub's issue form does: closing with text posts it first. */
function Composer({ issue }: { issue: Issue }) {
  const { busy } = useAppState()
  const [text, setText] = useState('')
  const idle = busy === null
  const send = (label: string, action: Parameters<typeof actOnIssue>[1]) => async () => {
    if (await actOnIssue(label, action)) setText('')
  }
  const withText = text.trim() !== ''
  return html`<div class="composer">
    <textarea
      rows="3"
      placeholder="Leave a comment"
      aria-label="Comment"
      value=${text}
      onInput=${(e: Event) => setText((e.target as HTMLTextAreaElement).value)}
    ></textarea>
    <div class="row wrap">
      <button
        class="btn primary"
        disabled=${!withText || !idle}
        onClick=${send('Commenting', { kind: 'comment', body: text })}
      >
        Comment
      </button>
      ${
        issue.state === 'OPEN'
          ? html`<button
                class="btn outline"
                disabled=${!idle}
                onClick=${send('Closing', { kind: 'close', reason: 'completed', body: text })}
              >
                <${Icon}
                  name="circleCheck"
                  size=${14}
                  class="tone-done"
                />${withText ? 'Close with comment' : 'Close issue'}
              </button>
              <button
                class="btn ghost"
                disabled=${!idle}
                onClick=${send('Closing', { kind: 'close', reason: 'not planned', body: text })}
              >
                <${Icon} name="circleSlash" size=${14} />Not planned
              </button>`
          : html`<button class="btn outline" disabled=${!idle} onClick=${send('Reopening', { kind: 'reopen' })}>
              <${Icon} name="circleDot" size=${14} class="tone-success" />Reopen
            </button>`
      }
    </div>
  </div>`
}

export function IssueView({ issue }: { issue: Issue }) {
  const { busy, notice, loadError } = useAppState()
  return html`<div>
    <${Header} issue=${issue} />
    <div class="stack" style="padding-top:12px">
      ${busy ? html`<p class="xs muted" style="margin:0">${busy}...</p>` : null}
      ${notice ? html`<p class=${`notice ${notice.tone}`}>${notice.text}</p>` : null}
      ${loadError ? html`<p class="notice warning">${loadError}</p>` : null}
      <div class="timeline">
        <${ImageStrip} pr=${issue} />
        <${Description} pr=${issue} />
        ${issue.timeline.map((entry) => html`<${Entry} key=${entry.id} entry=${entry} issue=${true} />`)}
        <${Composer} issue=${issue} />
      </div>
    </div>
  </div>`
}
