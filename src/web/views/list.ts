// A repository's pull requests or issues in Orca's list style, the kind picked on top as GitHub's
// repository tabs do, then Open and Closed. With no repository to show, what involves you everywhere.
import type { Inbox, InboxItem, InboxSection, LinkedItem } from '../../protocol'
import { describeLinked, describeRow, stateOf } from '../../ui/format'
import { html, useState } from '../../vendor/preact.mjs'
import { Icon, type IconName } from '../icon'
import { issueIcon, prIcon, QuestionTag } from './pull-request'
import {
  askedKeys,
  currentRepo,
  getState,
  loadList,
  openExternal,
  setListKind,
  setListState,
  showIssue,
  showPullRequest,
  showWorkspace,
  mentionedKeys,
  shownMentions,
  shownPulls,
  useAppState,
  workspacePullRequest
} from '../store'

function iconOf(item: InboxItem): { name: IconName; tone: string } {
  if (item.kind === 'issue') return issueIcon(item)
  if (item.state === 'MERGED') return { name: 'gitMerge', tone: 'done' }
  if (item.state === 'CLOSED') return { name: 'gitPullRequestClosed', tone: 'danger' }
  if (item.isDraft) return { name: 'gitPullRequestDraft', tone: 'neutral' }
  return { name: 'gitPullRequest', tone: 'success' }
}

const CHECKS_MARK = {
  failure: { icon: 'circleX', tone: 'tone-danger', label: 'Checks failing' },
  pending: { icon: 'loaderCircle', tone: 'tone-warning spin', label: 'Checks running' },
  success: { icon: 'circleCheck', tone: 'tone-success', label: 'Checks passing' }
} as const

/** Checks show at the end of the row, where Orca puts a row's status, named for those who cannot see the colour. */
function ChecksMark({ item }: { item: InboxItem }) {
  if (item.kind !== 'pr' || item.state !== 'OPEN' || item.checks === 'none') return null
  const mark = CHECKS_MARK[item.checks]
  return html`<span class="mark" role="img" title=${mark.label} aria-label=${mark.label}
    ><${Icon} name=${mark.icon} size=${14} class=${mark.tone}
  /></span>`
}

function open(item: Pick<LinkedItem, 'kind' | 'repo' | 'number'>): void {
  if (item.kind === 'pr') showPullRequest(item.repo, item.number)
  else showIssue(item.repo, item.number)
}

/** Marks a row an agent of the focused workspace named, where it already stands in the list. */
function AgentTag() {
  return html`<span class="tag" title="Mentioned by an agent of this workspace"
    ><${Icon} name="bot" size=${12} />Mentioned</span
  >`
}

function Rows({ items, showRepo, current }: { items: InboxItem[]; showRepo: boolean; current?: string | null }) {
  const now = Date.now()
  const mentioned = mentionedKeys()
  const asked = askedKeys()
  return html`<div class="list">
    ${items.map((item) => {
      const icon = iconOf(item)
      const key = `${item.repo}#${item.number}`
      const isCurrent = key === current
      const question = asked.get(key.toLowerCase())
      return html`<button
        class=${`list-row${isCurrent ? ' current' : ''}${question ? ' asked' : ''}`}
        key=${key}
        title=${item.title}
        aria-current=${isCurrent ? 'true' : undefined}
        onClick=${() => (isCurrent ? showWorkspace() : open(item))}
      >
        <${Icon} name=${icon.name} size=${16} class=${`tone-${icon.tone}`} />
        <span class="body">
          <span class="primary">${item.title}</span>
          <span class="secondary">${describeRow(item, showRepo, now)}</span>
        </span>
        <span class="side"
          >${isCurrent ? html`<span class="tag">This branch</span>` : null}${question ? html`<${QuestionTag} question=${question} />` : mentioned.has(key.toLowerCase()) ? html`<${AgentTag} />` : null}<${ChecksMark}
            item=${item}
        /></span>
      </button>`
    })}
  </div>`
}

function Section({ title, section, empty }: { title: string; section: InboxSection; empty: string }) {
  return html`<section class="stack" style="gap:4px">
    <div class="section-head">
      <h2 class="section-label">${title}</h2>
      ${section.total ? html`<span class="pill">${section.total}</span>` : null}
    </div>
    ${section.items.length === 0 ? html`<p class="xs muted" style="margin:0">${empty}</p>` : html`<${Rows} items=${section.items} showRepo=${true} />`}
    ${
      section.total > section.items.length
        ? html`<div>
            <button class="btn ghost sm" onClick=${() => openExternal(section.viewAllUrl)}>
              View all ${section.total} on GitHub
            </button>
          </div>`
        : null
    }
  </section>`
}

const MENTIONED_SHOWN = 8

/**
 * What the focused workspace's agents named that no section below can show: merged or closed, or
 * not involving you, as most of what a bot works on. A named row the sections hold is tagged there.
 */
function Mentioned({ inbox }: { inbox: Inbox | null }) {
  const [all, setAll] = useState(false)
  const keyOf = (item: { repo: string; number: number }) => `${item.repo}#${item.number}`.toLowerCase()
  const listed = new Set((inbox ? [inbox.review, inbox.mine, inbox.issues] : []).flatMap((s) => s.items).map(keyOf))
  const named = shownMentions().filter((mention) => !listed.has(keyOf(mention)))
  if (named.length === 0) return null
  // what is still open leads: the rest is already settled
  const items = [...named.filter((item) => item.state === 'OPEN'), ...named.filter((item) => item.state !== 'OPEN')]
  const asked = askedKeys()
  return html`<section class="stack" style="gap:4px">
    <div class="section-head">
      <h2 class="section-label">Mentioned in this workspace</h2>
      <span class="pill">${items.length}</span>
    </div>
    <div class="list">
      ${(all ? items : items.slice(0, MENTIONED_SHOWN)).map((item) => {
        const icon = item.kind === 'issue' ? issueIcon(item) : prIcon(item)
        const question = asked.get(keyOf(item))
        return html`<button
          class=${`list-row${question ? ' asked' : ''}`}
          key=${keyOf(item)}
          title=${item.title}
          onClick=${() => open(item)}
        >
          <${Icon} name=${icon.name} size=${16} class=${`tone-${icon.tone}`} />
          <span class="body">
            <span class="primary">${item.title}</span>
            <span class="secondary">${describeLinked(item)}</span>
          </span>
          ${question ? html`<span class="side"><${QuestionTag} question=${question} /></span>` : null}
        </button>`
      })}
    </div>
    ${
      // the button stays where it was pressed, so the keyboard keeps its place in the list
      items.length > MENTIONED_SHOWN
        ? html`<div>
            <button class="btn ghost sm" aria-expanded=${all} onClick=${() => setAll(!all)}>
              ${all ? 'Show fewer' : `Show all ${items.length}`}
            </button>
          </div>`
        : null
    }
  </section>`
}

function Dashboard() {
  const { inbox, listError } = useAppState()
  // what the agents named is known before GitHub answers: it shows at once, and through a failed load
  if (!inbox) {
    return html`<div class="stack" style="gap:16px">
      <${Mentioned} inbox=${null} />
      ${listError ? null : html`<p class="empty">Loading your pull requests...</p>`}
    </div>`
  }
  return html`<div class="stack" style="gap:16px">
    <${Mentioned} inbox=${inbox} />
    <${Section} title="Review requests" section=${inbox.review} empty="Nothing is waiting for your review." />
    <${Section} title="Your pull requests" section=${inbox.mine} empty="You have no open pull request." />
    <${Section} title="Your issues" section=${inbox.issues} empty="No open issue involves you." />
  </div>`
}

/** The focused worktree's PR stays one press away: pinned at the head of the rows when they leave it out. */
function ThisBranch() {
  const { pr } = useAppState()
  const own = workspacePullRequest()
  if (!own) return null
  if (shownPulls()?.items.some((each) => each.repo === own.repo && each.number === own.number)) return null
  const loaded = pr && pr.repo === own.repo && pr.number === own.number ? pr : null
  const icon = loaded ? prIcon(loaded) : { name: 'gitPullRequest' as const, tone: 'neutral' }
  const question = askedKeys().get(`${own.repo}#${own.number}`.toLowerCase())
  return html`<div class="list pin">
    <button class=${`list-row current${question ? ' asked' : ''}`} aria-current="true" onClick=${showWorkspace}>
      <${Icon} name=${icon.name} size=${16} class=${`tone-${icon.tone}`} />
      <span class="body">
        <span class="primary">${loaded?.title ?? `Pull request #${own.number}`}</span>
        <span class="secondary">#${own.number}${loaded ? `, ${stateOf(loaded).label.toLowerCase()}` : ''}</span>
      </span>
      <span class="side"
        ><span class="tag">This branch</span>${question ? html`<${QuestionTag} question=${question} />` : null}</span
      >
    </button>
  </div>`
}

/**
 * On a kind tab: how many of its Open or Closed rows a question names, then how many an agent
 * only mentioned, so neither is missed from the other tab. Each count means what its row tag means.
 */
function mentionCount(kind: 'pr' | 'issue') {
  const { listState, questions } = getState()
  const repo = currentRepo()?.toLowerCase()
  // only what the selected Open or Closed rows can hold, so the counts match the tags below them
  const fits = (item: LinkedItem) =>
    item.kind === kind && item.repo.toLowerCase() === repo && (item.state === 'OPEN') === (listState === 'open')
  const keyOf = (item: LinkedItem) => `${item.repo}#${item.number}`.toLowerCase()
  const asked = new Set(
    questions
      .flatMap((question) => question.items)
      .filter(fits)
      .map(keyOf)
  )
  const mentioned = shownMentions().filter((mention) => fits(mention) && !asked.has(keyOf(mention))).length
  return html`${
    asked.size > 0
      ? html`<span class="tag asked" title=${`${asked.size} named in a question an agent of this worktree asked`}
          ><${Icon} name="messageCircleQuestion" size=${12} />${asked.size}</span
        >`
      : null
  }${
    mentioned > 0
      ? html`<span class="tag" title=${`${mentioned} mentioned by agents of this worktree`}
          ><${Icon} name="bot" size=${12} />${mentioned}</span
        >`
      : null
  }`
}

function Repository({ repo }: { repo: string }) {
  const { listState, listKind, listError } = useAppState()
  // only this repository's rows, from the cache while they refetch
  const data = shownPulls()
  const total = data ? (listState === 'open' ? data.open : data.closed) : 0
  const own = workspacePullRequest()
  const noun = listKind === 'pr' ? 'pull requests' : 'issues'
  return html`<div class="stack">
    <div class="tabs" role="group" aria-label=${`What to list in ${repo}`}>
      ${(
        [
          ['pr', 'Pull requests', 'gitPullRequest'],
          ['issue', 'Issues', 'circleDot']
        ] as const
      ).map(
        ([value, label, icon]) =>
          html`<button
            aria-pressed=${listKind === value}
            class=${listKind === value ? 'tab active' : 'tab'}
            onClick=${() => setListKind(value)}
          >
            <${Icon} name=${icon} size=${14} />${label}${mentionCount(value)}
          </button>`
      )}
    </div>
    <div class="state-tabs" role="group" aria-label=${`Open or closed ${noun}`}>
      ${(['open', 'closed'] as const).map(
        (value) =>
          html`<button aria-pressed=${listState === value} onClick=${() => setListState(value)}>
            <${Icon} name=${value === 'open' ? 'circleDot' : 'check'} size=${14} />
            ${data ? `${value === 'open' ? data.open : data.closed} ` : ''}${value === 'open' ? 'Open' : 'Closed'}
          </button>`
      )}
    </div>
    ${listKind === 'pr' ? html`<${ThisBranch} />` : null}
    ${
      !data
        ? listError
          ? null
          : html`<p class="empty">Loading ${noun}...</p>`
        : data.items.length === 0
          ? html`<p class="empty">No ${listState} ${noun}.</p>`
          : html`<${Rows}
              items=${data.items}
              showRepo=${false}
              current=${listKind === 'pr' && own ? `${own.repo}#${own.number}` : null}
            />`
    }
    ${
      data && total > data.items.length
        ? html`<div>
            <button class="btn ghost sm" onClick=${() => openExternal(data.viewAllUrl)}>
              View all ${total} on GitHub
            </button>
          </div>`
        : null
    }
  </div>`
}

/** The list, reached from a PR's back button or shown when the branch has no PR. */
export function ListView({ reason }: { reason?: string }) {
  const { listError, listLoading } = useAppState()
  const repo = currentRepo()
  return html`<div>
    <div class="topbar">
      <span class="row grow" style="padding-left:6px">
        <${Icon} name="gitPullRequest" size=${14} class="muted" />
        <span class="xs truncate">${repo ?? 'GitHub'}</span>
      </span>
      <button
        class="icon-btn"
        title="Refresh"
        aria-label="Refresh"
        disabled=${listLoading}
        onClick=${() => loadList(true)}
      >
        <${Icon} name="refreshCw" class=${listLoading ? 'spin' : ''} />
      </button>
    </div>
    ${reason ? html`<p class="xs muted" style="margin:0 0 4px">${reason}</p>` : null}
    <div class="stack" style="padding-top:12px">
      ${listError ? html`<p class="notice danger">Could not reach GitHub: ${listError}</p>` : null}
      ${repo ? html`<${Repository} repo=${repo} />` : html`<${Dashboard} />`}
    </div>
  </div>`
}
